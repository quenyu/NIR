from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from app.models.projects import (
    ProjectCreateRequest,
    ProjectPayload,
    ProjectRecord,
    ProjectSummary,
    ProjectUpdateRequest,
)


class ProjectNotFoundError(LookupError):
    pass


class ProjectVersionConflictError(RuntimeError):
    def __init__(self, current_version: int):
        super().__init__("Версия проекта изменилась на сервере.")
        self.current_version = current_version


class ProjectRepository:
    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
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

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    @staticmethod
    def _payload_json(payload: ProjectPayload) -> str:
        return json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _record(row: sqlite3.Row) -> ProjectRecord:
        return ProjectRecord(
            id=row["id"],
            title=row["title"],
            version=row["version"],
            block_count=row["block_count"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            payload=ProjectPayload.model_validate(json.loads(row["payload_json"])),
        )

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

    def create(self, request: ProjectCreateRequest) -> ProjectRecord:
        project_id = str(uuid4())
        timestamp = self._timestamp()
        block_count = len(request.payload.diagram.blocks)
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO projects(id, title, payload_json, block_count, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
                (project_id, request.title, self._payload_json(request.payload), block_count, timestamp, timestamp),
            )
        return self.get(project_id)

    def list(self) -> list[ProjectSummary]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, title, block_count, version, created_at, updated_at FROM projects ORDER BY updated_at DESC, title ASC"
            ).fetchall()
        return [self._summary(row) for row in rows]

    def get(self, project_id: str) -> ProjectRecord:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row is None:
            raise ProjectNotFoundError(project_id)
        return self._record(row)

    def update(self, project_id: str, request: ProjectUpdateRequest) -> ProjectRecord:
        timestamp = self._timestamp()
        block_count = len(request.payload.diagram.blocks)
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE projects
                SET title = ?, payload_json = ?, block_count = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND version = ?
                """,
                (
                    request.title,
                    self._payload_json(request.payload),
                    block_count,
                    timestamp,
                    project_id,
                    request.expected_version,
                ),
            )
            if cursor.rowcount == 0:
                row = connection.execute("SELECT version FROM projects WHERE id = ?", (project_id,)).fetchone()
                if row is None:
                    raise ProjectNotFoundError(project_id)
                raise ProjectVersionConflictError(int(row["version"]))
        return self.get(project_id)

    def delete(self, project_id: str) -> None:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            if cursor.rowcount == 0:
                raise ProjectNotFoundError(project_id)


@lru_cache(maxsize=1)
def get_project_repository() -> ProjectRepository:
    default_path = Path(__file__).resolve().parents[2] / "data" / "projects.db"
    return ProjectRepository(os.environ.get("NIR_PROJECT_DB_PATH", default_path))
