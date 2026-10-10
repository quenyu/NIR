from __future__ import annotations

import gc
import json
import sqlite3
import warnings
from contextlib import closing
from pathlib import Path

import pytest

from app.models.projects import ProjectCreateRequest
from app.storage.projects import (
    SCHEMA_VERSION,
    ProjectCorruptedError,
    ProjectPayloadTooLargeError,
    ProjectRepository,
)
from app.tests.helpers import first_order_step_diagram


def _request(title: str = "Модель") -> ProjectCreateRequest:
    return ProjectCreateRequest.model_validate({"title": title, "payload": {"diagram": first_order_step_diagram()}})


def test_connections_are_closed_after_each_operation(tmp_path: Path) -> None:
    repository = ProjectRepository(tmp_path / "projects.db")
    with warnings.catch_warnings():
        warnings.simplefilter("error", ResourceWarning)
        record = repository.create(_request())
        repository.get(record.id)
        repository.list()
        repository.delete(record.id)
        gc.collect()  # an unclosed sqlite3.Connection would warn here


def test_legacy_database_without_schema_version_is_migrated(tmp_path: Path) -> None:
    """Databases written by the archived version have the table but user_version = 0."""

    path = tmp_path / "legacy.db"
    payload = {"diagram": first_order_step_diagram(), "layout": {"positions": {}}, "simulation": {}}
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, payload_json TEXT NOT NULL, "
        "block_count INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    connection.execute(
        "INSERT INTO projects VALUES ('p1', 'Старый проект', ?, 3, 4, "
        "'2026-07-01T10:00:00+00:00', '2026-07-02T10:00:00+00:00')",
        (json.dumps(payload),),
    )
    connection.commit()
    connection.close()

    repository = ProjectRepository(path)

    record = repository.get("p1")
    assert record.version == 4
    assert record.payload.diagram.blocks[1].id == "lag1"
    with closing(sqlite3.connect(path)) as check, check:
        assert check.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


def test_newer_schema_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "future.db"
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
    with pytest.raises(RuntimeError, match="более новой версией"):
        ProjectRepository(path)


def test_corrupted_record_is_reported(tmp_path: Path) -> None:
    repository = ProjectRepository(tmp_path / "projects.db")
    record = repository.create(_request())
    with closing(sqlite3.connect(tmp_path / "projects.db")) as connection, connection:
        connection.execute("UPDATE projects SET payload_json = '{broken' WHERE id = ?", (record.id,))

    with pytest.raises(ProjectCorruptedError):
        repository.get(record.id)


def test_oversized_payload_is_rejected(tmp_path: Path) -> None:
    repository = ProjectRepository(tmp_path / "projects.db")
    request = _request()
    request.payload.diagram.blocks[0].parameters["note"] = "x" * (6 * 1024 * 1024)

    with pytest.raises(ProjectPayloadTooLargeError):
        repository.create(request)
