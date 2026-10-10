from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from app.models.projects import (
    ProjectCreateRequest,
    ProjectPayload,
    ProjectRecord,
    ProjectSummary,
    ProjectUpdateRequest,
)

# Schema versions, stored in PRAGMA user_version. Databases created before
# versioning (user_version = 0) already have the version-1 table.
SCHEMA_VERSION = 1
MAX_PAYLOAD_BYTES = 5 * 1024 * 1024


class ProjectNotFoundError(LookupError):
    pass


class ProjectVersionConflictError(RuntimeError):
    def __init__(self, current_version: int):
        super().__init__("Проект уже изменён в другой сессии.")
        self.current_version = current_version


class ProjectPayloadTooLargeError(ValueError):
    pass


class ProjectCorruptedError(RuntimeError):
    pass


class ProjectRepository:
    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        """One connection per operation: commit or roll back, then always close."""

        connection = sqlite3.connect(self.database_path, timeout=10.0)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._transaction() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if version > SCHEMA_VERSION:
                raise RuntimeError(
                    f"База проектов создана более новой версией приложения (схема {version})."
                )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    block_count INTEGER NOT NULL,
                    version INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC)"
            )
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(UTC).replace(microsecond=0).isoformat()

    @staticmethod
    def _payload_json(payload: ProjectPayload) -> str:
        encoded = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_PAYLOAD_BYTES:
            raise ProjectPayloadTooLargeError("Проект превышает допустимый размер 5 МБ.")
        return encoded

    @staticmethod
    def _summary(row: sqlite3.Row) -> ProjectSummary:
        return ProjectSummary(
            id=row["id"],
            title=row["title"],
            version=row["version"],
            block_count=row["block_count"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )

    @classmethod
    def _record(cls, row: sqlite3.Row) -> ProjectRecord:
        try:
            payload = ProjectPayload.model_validate(json.loads(row["payload_json"]))
        except (json.JSONDecodeError, ValidationError) as exc:
            raise ProjectCorruptedError(f"Сохранённый проект '{row['id']}' повреждён.") from exc
        return ProjectRecord(**cls._summary(row).model_dump(), payload=payload)

    @staticmethod
    def _select(connection: sqlite3.Connection, project_id: str) -> sqlite3.Row:
        row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise ProjectNotFoundError(project_id)
        return row

    def create(self, request: ProjectCreateRequest) -> ProjectRecord:
        project_id = str(uuid4())
        timestamp = self._timestamp()
        payload_json = self._payload_json(request.payload)
        with self._transaction() as connection:
            connection.execute(
                "INSERT INTO projects(id, title, payload_json, block_count, version, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 1, ?, ?)",
                (project_id, request.title, payload_json, len(request.payload.diagram.blocks), timestamp, timestamp),
            )
            return self._record(self._select(connection, project_id))

    def list(self) -> list[ProjectSummary]:
        with self._transaction() as connection:
            rows = connection.execute(
                "SELECT id, title, block_count, version, created_at, updated_at "
                "FROM projects ORDER BY updated_at DESC, title ASC"
            ).fetchall()
        return [self._summary(row) for row in rows]

    def get(self, project_id: str) -> ProjectRecord:
        with self._transaction() as connection:
            return self._record(self._select(connection, project_id))

    def update(self, project_id: str, request: ProjectUpdateRequest) -> ProjectRecord:
        payload_json = self._payload_json(request.payload)
        with self._transaction() as connection:
            cursor = connection.execute(
                """
                UPDATE projects
                SET title = ?, payload_json = ?, block_count = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND version = ?
                """,
                (
                    request.title,
                    payload_json,
                    len(request.payload.diagram.blocks),
                    self._timestamp(),
                    project_id,
                    request.expected_version,
                ),
            )
            if cursor.rowcount == 0:
                raise ProjectVersionConflictError(int(self._select(connection, project_id)["version"]))
            return self._record(self._select(connection, project_id))

    def delete(self, project_id: str) -> None:
        with self._transaction() as connection:
            if connection.execute("DELETE FROM projects WHERE id = ?", (project_id,)).rowcount == 0:
                raise ProjectNotFoundError(project_id)


@lru_cache(maxsize=1)
def get_project_repository() -> ProjectRepository:
    default_path = Path(__file__).resolve().parents[2] / "data" / "projects.db"
    return ProjectRepository(os.environ.get("NIR_PROJECT_DB_PATH", default_path))
