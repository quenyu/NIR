from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import re
import struct
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = (
    Path("start_windows.bat"),
    Path("run_backend.bat"),
    Path("run_frontend.bat"),
    Path("tools/prepare_runtime.py"),
    Path("tools/runtime_diagnostics.py"),
    Path("tools/serve_frontend.py"),
    Path("frontend/dist/index.html"),
    Path("backend/app/main.py"),
)
EXCLUDED_DIRECTORIES = {
    ".git",
    ".linux-packages",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".vite",
    ".venv-linux",
    "__pycache__",
    "artifacts",
    "design-system",
    "node_modules",
    "playwright-report",
    "practice_documents",
    "test-results",
}
EXCLUDED_PATH_PREFIXES = {
    Path("backend/build"),
    Path("backend/nir_dynamics_backend.egg-info"),
}
EXCLUDED_SUFFIXES = {".pyc", ".pyo", ".tsbuildinfo"}
EXCLUDED_FILES = {
    Path("START_HERE.txt"),
    Path("HIERARCHY_VERIFICATION.md"),
    Path("IMPLEMENTATION_SUMMARY.md"),
    Path("backend/data/projects.db"),
    Path("docs/CODEX_REDESIGN_PROMPT.md"),
    Path("docs/GENERATED_VISUAL_ASSETS.md"),
    Path("docs/architecture_notes.md"),
    Path("docs/development_iteration_01.md"),
    Path("docs/development_iteration_02.md"),
    Path("docs/development_iteration_03.md"),
    Path("docs/development_iteration_04_06.md"),
    Path("docs/nir_report_notes.md"),
    Path("docs/report_comparison_template.md"),
    Path("docs/transfer_function.md"),
    Path("docs/uiux_v2.md"),
    Path("frontend/playwright.config.d.ts"),
    Path("frontend/playwright.config.js"),
    Path("frontend/vite.config.d.ts"),
    Path("frontend/vite.config.js"),
    Path("tools/capture_v22_screenshots.mjs"),
    Path("tools/capture_v23_screenshots.mjs"),
}
PE_MACHINE_AMD64 = 0x8664


def read_pe_machine(path: Path) -> int:
    """Return the COFF machine value from a Windows PE executable."""
    with path.open("rb") as binary:
        header = binary.read(64)
        if len(header) < 64 or header[:2] != b"MZ":
            raise ValueError("missing DOS/PE header")
        pe_offset = struct.unpack_from("<I", header, 0x3C)[0]
        binary.seek(pe_offset)
        pe_header = binary.read(6)
        if len(pe_header) < 6 or pe_header[:4] != b"PE\0\0":
            raise ValueError("missing PE signature")
        return struct.unpack_from("<H", pe_header, 4)[0]


def validate_windows_extensions() -> None:
    runtime_root = PROJECT_ROOT / "runtime_packages"
    windows_extensions = sorted(
        path
        for pattern in ("*.pyd", "*.dll")
        for path in runtime_root.rglob(pattern)
    )
    if not windows_extensions:
        raise SystemExit("Bundled Windows Python extensions were not found in runtime_packages.")

    invalid_extensions: list[str] = []
    for path in windows_extensions:
        try:
            machine = read_pe_machine(path)
        except (OSError, ValueError) as error:
            invalid_extensions.append(f"{path.relative_to(PROJECT_ROOT)} ({error})")
            continue
        if machine != PE_MACHINE_AMD64:
            invalid_extensions.append(
                f"{path.relative_to(PROJECT_ROOT)} (PE machine 0x{machine:04x}, expected x64)"
            )

    if invalid_extensions:
        formatted = "\n".join(f"- {item}" for item in invalid_extensions)
        raise SystemExit(f"Bundled runtime contains non-x64 or invalid extensions:\n{formatted}")

    for package in ("numpy", "scipy", "pydantic_core"):
        wheel_files = sorted(runtime_root.glob(f"{package}-*.dist-info/WHEEL"))
        if len(wheel_files) != 1:
            raise SystemExit(f"Expected one WHEEL metadata file for {package}, found {len(wheel_files)}.")
        wheel_text = wheel_files[0].read_text(encoding="utf-8")
        if "Tag: cp313-cp313-win_amd64" not in wheel_text:
            raise SystemExit(
                f"{wheel_files[0].relative_to(PROJECT_ROOT)} is not a CPython 3.13 x64 wheel."
            )


def validate_runtime_record_hashes() -> None:
    """Verify installed runtime files against their wheel RECORD metadata."""
    runtime_root = PROJECT_ROOT / "runtime_packages"
    failures: list[str] = []
    checked: set[Path] = set()

    for record_path in sorted(runtime_root.glob("*.dist-info/RECORD")):
        with record_path.open(newline="", encoding="utf-8") as record_file:
            for relative_name, digest_entry, size_entry in csv.reader(record_file):
                relative_path = Path(relative_name)
                if ".." in relative_path.parts or not digest_entry:
                    continue
                if "tests" in relative_path.parts:
                    # The portable bundle intentionally omits dependency-owned
                    # NumPy/SciPy test suites. They are not imported at runtime.
                    continue
                if relative_path.suffix.lower() == ".whl" and size_entry == "0":
                    # SciPy carries a zero-byte build marker named after its wheel;
                    # pip does not retain it in a target installation.
                    continue
                path = runtime_root / relative_path
                checked.add(path)
                if not path.is_file():
                    failures.append(f"{relative_name} (missing)")
                    continue
                if size_entry and path.stat().st_size != int(size_entry):
                    failures.append(
                        f"{relative_name} (size {path.stat().st_size}, expected {size_entry})"
                    )
                    continue
                if digest_entry.startswith("sha256="):
                    actual = base64.urlsafe_b64encode(hashlib.sha256(path.read_bytes()).digest()).rstrip(b"=").decode("ascii")
                    expected = digest_entry.removeprefix("sha256=")
                    if actual != expected:
                        failures.append(f"{relative_name} (SHA-256 mismatch)")

    if not checked:
        raise SystemExit("No hashed runtime files were found in wheel RECORD metadata.")
    if failures:
        formatted = "\n".join(f"- {failure}" for failure in failures)
        raise SystemExit(f"Bundled runtime contains corrupted or incomplete files:\n{formatted}")


def validate_windows_bundle() -> None:
    missing = [str(path) for path in REQUIRED_FILES if not (PROJECT_ROOT / path).is_file()]
    if missing:
        formatted = "\n".join(f"- {path}" for path in missing)
        raise SystemExit(
            "Windows package is incomplete. Build the frontend first with "
            f"`npm run build`. Missing files:\n{formatted}"
        )

    index_text = (PROJECT_ROOT / "frontend/dist/index.html").read_text(encoding="utf-8")
    asset_paths = re.findall(r'(?:src|href)="/([^\"]+)"', index_text)
    missing_assets = [path for path in asset_paths if not (PROJECT_ROOT / "frontend/dist" / path).is_file()]
    if missing_assets:
        formatted = "\n".join(f"- frontend/dist/{path}" for path in missing_assets)
        raise SystemExit(f"Frontend build references missing assets:\n{formatted}")

    validate_windows_extensions()
    validate_runtime_record_hashes()


def should_exclude(relative_path: Path) -> bool:
    if any(part in EXCLUDED_DIRECTORIES for part in relative_path.parts):
        return True
    if relative_path in EXCLUDED_FILES:
        return True
    if re.fullmatch(r"RELEASE_V\d+\.txt", relative_path.name, flags=re.IGNORECASE):
        return True
    if re.search(r"_V\d+\.md$", relative_path.name, flags=re.IGNORECASE):
        return True
    if any(relative_path.is_relative_to(prefix) for prefix in EXCLUDED_PATH_PREFIXES):
        return True
    return relative_path.suffix.lower() in EXCLUDED_SUFFIXES


def create_archive(output_path: Path) -> None:
    if output_path.exists():
        raise SystemExit(f"Output file already exists: {output_path}")
    if output_path.is_relative_to(PROJECT_ROOT):
        raise SystemExit("Output archive must be created outside the project directory.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output_path, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for source_path in sorted(PROJECT_ROOT.rglob("*")):
            if not source_path.is_file():
                continue
            relative_path = source_path.relative_to(PROJECT_ROOT)
            if should_exclude(relative_path):
                continue
            archive.write(source_path, Path("Control_Lab") / relative_path)

    with ZipFile(output_path) as archive:
        broken_file = archive.testzip()
        if broken_file is not None:
            raise SystemExit(f"Archive verification failed: {broken_file}")

        required_member = "Control_Lab/frontend/dist/index.html"
        if required_member not in archive.namelist():
            raise SystemExit(f"Archive does not contain required file: {required_member}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a verified ready-to-run Windows archive.")
    parser.add_argument("output", type=Path, help="Path of the new .zip archive")
    args = parser.parse_args()

    output_path = args.output.expanduser().resolve()
    validate_windows_bundle()
    create_archive(output_path)
    print(f"Created and verified: {output_path}")


if __name__ == "__main__":
    main()
