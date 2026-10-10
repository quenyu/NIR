from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path


RUNTIME_ID = "cp313-win-amd64-numpy-2.4.6-scipy-1.17.1-v3"
MARKER_NAME = ".control-lab-runtime.json"
REQUIRED_PATHS = (
    Path("numpy/__init__.py"),
    Path("numpy/_core/_multiarray_umath.cp313-win_amd64.pyd"),
    Path("scipy/__init__.py"),
    Path("pydantic_core/_pydantic_core.cp313-win_amd64.pyd"),
    Path("fastapi/__init__.py"),
    Path("uvicorn/__init__.py"),
)
CRITICAL_HASHES = {
    Path("numpy.libs/libscipy_openblas64_-63c857e738469261263c764a36be9436.dll"): "63c857e738469261263c764a36be9436ebdeaa272e340a828f42047a97131080",
    Path("scipy/spatial/transform/_rigid_transform_cy.cp313-win_amd64.pyd"): "990a87d197cc89c6dc4c9f675ca1e80f52b8e3523350cc37af9ba833daa6b47b",
    Path("scipy/special/_special_ufuncs.cp313-win_amd64.pyd"): "633214f84c53230e3f6b11795a5ff313a1e339923137853912d96e2c4fe47feb",
    Path("scipy/spatial/transform/_rotation.py"): "307bb7c9dfff61d28383536a1c8e3ad7396221ca33b0fe71fccb7aac5bd861d6",
}


def validate_source(source: Path) -> None:
    missing = [str(path) for path in REQUIRED_PATHS if not (source / path).is_file()]
    if missing:
        formatted = "\n".join(f"- {path}" for path in missing)
        raise SystemExit(f"Bundled Python runtime is incomplete:\n{formatted}")
    corrupted = []
    for relative_path, expected_hash in CRITICAL_HASHES.items():
        path = source / relative_path
        if not path.is_file():
            corrupted.append(f"{relative_path} (missing)")
            continue
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            corrupted.append(f"{relative_path} (SHA-256 mismatch)")
    if corrupted:
        formatted = "\n".join(f"- {path}" for path in corrupted)
        raise SystemExit(f"Bundled Python runtime contains corrupted files:\n{formatted}")


def cache_is_ready(target: Path) -> bool:
    marker_path = target / MARKER_NAME
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return marker.get("runtime_id") == RUNTIME_ID and all(
        (target / path).is_file() for path in REQUIRED_PATHS
    )


def remove_tree(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)


def prepare_runtime(source: Path, target: Path, force: bool = False) -> bool:
    source = source.expanduser().resolve()
    target = target.expanduser().resolve()
    validate_source(source)

    if source == target or source in target.parents:
        raise SystemExit("Runtime cache must be outside the bundled runtime directory.")

    if not force and cache_is_ready(target):
        print(f"Runtime cache is ready: {target}")
        return False

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.tmp-{os.getpid()}")
    backup = target.with_name(f"{target.name}.old-{os.getpid()}")
    remove_tree(temporary)
    remove_tree(backup)

    try:
        # copyfile intentionally copies only the primary data stream. On Windows
        # this prevents browser Zone.Identifier metadata from following the
        # bundled .pyd and .dll files into the trusted per-user runtime cache.
        shutil.copytree(
            source,
            temporary,
            copy_function=shutil.copyfile,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
        )
        (temporary / MARKER_NAME).write_text(
            json.dumps({"runtime_id": RUNTIME_ID}, ensure_ascii=True),
            encoding="utf-8",
        )

        if target.exists():
            os.replace(target, backup)
        os.replace(temporary, target)
        remove_tree(backup)
    except BaseException:
        remove_tree(temporary)
        if backup.exists() and not target.exists():
            os.replace(backup, target)
        raise

    print(f"Runtime cache prepared: {target}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare an unblocked per-user cache of bundled Windows Python packages."
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    prepare_runtime(args.source, args.target, args.force)


if __name__ == "__main__":
    main()
