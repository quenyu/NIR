from __future__ import annotations

import argparse
import ctypes
import os
import platform
import struct
import sys
from pathlib import Path


def pe_machine(path: Path) -> str:
    try:
        with path.open("rb") as binary:
            header = binary.read(64)
            if len(header) < 64 or header[:2] != b"MZ":
                return "not a PE file"
            pe_offset = struct.unpack_from("<I", header, 0x3C)[0]
            binary.seek(pe_offset)
            pe_header = binary.read(6)
            if len(pe_header) < 6 or pe_header[:4] != b"PE\0\0":
                return "invalid PE signature"
            machine = struct.unpack_from("<H", pe_header, 4)[0]
    except OSError as error:
        return f"unreadable: {error}"
    names = {0x8664: "AMD64", 0x14C: "x86", 0xAA64: "ARM64"}
    return f"{names.get(machine, 'unknown')} (0x{machine:04x})"


def zone_identifier(path: Path) -> str:
    if os.name != "nt":
        return "not checked outside Windows"
    try:
        with open(f"{path}:Zone.Identifier", "r", encoding="utf-8", errors="replace") as stream:
            content = stream.read(512).replace("\r", " ").replace("\n", " ").strip()
        return content or "present"
    except OSError:
        return "absent"


def try_load(path: Path) -> str:
    if os.name != "nt":
        return "not attempted outside Windows"
    try:
        ctypes.WinDLL(str(path))
        return "loaded"
    except OSError as error:
        return f"FAILED winerror={getattr(error, 'winerror', None)}: {error}"


def report_file(label: str, path: Path) -> None:
    print(f"[{label}]")
    print(f"path={path}")
    print(f"exists={path.is_file()}")
    if path.is_file():
        print(f"size={path.stat().st_size}")
        print(f"pe_machine={pe_machine(path)}")
        print(f"zone_identifier={zone_identifier(path)}")
        print(f"load_library={try_load(path)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnose Control Lab Windows DLL loading.")
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()

    runtime = args.runtime.expanduser().resolve()
    source = args.source.expanduser().resolve()
    print("Control Lab runtime diagnostics")
    print(f"python={sys.executable}")
    print(f"python_version={sys.version}")
    print(f"platform_machine={platform.machine()}")
    print(f"pointer_bits={struct.calcsize('P') * 8}")
    print(f"runtime={runtime}")

    if os.name == "nt" and hasattr(os, "add_dll_directory"):
        for directory in (runtime / "numpy.libs", runtime / "scipy.libs", Path(sys.executable).parent):
            if directory.is_dir():
                os.add_dll_directory(str(directory))

    filenames = {
        "cached numpy extension": runtime / "numpy/_core/_multiarray_umath.cp313-win_amd64.pyd",
        "cached NumPy OpenBLAS": runtime / "numpy.libs/libscipy_openblas64_-63c857e738469261263c764a36be9436.dll",
        "cached bundled MSVC": runtime / "numpy.libs/msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll",
        "source numpy extension": source / "numpy/_core/_multiarray_umath.cp313-win_amd64.pyd",
    }
    for label, path in filenames.items():
        report_file(label, path)


if __name__ == "__main__":
    main()
