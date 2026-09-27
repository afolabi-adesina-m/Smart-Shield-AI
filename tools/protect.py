#!/usr/bin/env python3
"""Encrypt or decrypt the Enterprise scoring engine.

The key comes from SMART_SHIELD_KEY or a gitignored .smart_shield_key file.
This command never writes a key unless you pass --out, and --out must be a
gitignored path. Do not commit the key or a ciphertext made with a throwaway key.

Examples:
    python tools/protect.py keygen
    SMART_SHIELD_KEY='...' python tools/protect.py encrypt
    SMART_SHIELD_KEY='...' python tools/protect.py decrypt
    python tools/protect.py check
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "demo"))

from engine_crypto import (  # noqa: E402
    EngineCryptoError,
    decrypt_bytes,
    encrypt_bytes,
    generate_key,
    load_key,
)
from engine_files import ENGINE_SOURCES, KEY_FILENAMES, MODEL_GLOBS  # noqa: E402

MANIFEST_NAME = "protected/manifest.json"


def _engine_paths(root: Path) -> list[str]:
    found = []
    for rel in ENGINE_SOURCES:
        if (root / rel).is_file():
            found.append(rel)
    for pattern in MODEL_GLOBS:
        for path in sorted(root.glob(pattern)):
            if path.is_file():
                found.append(path.relative_to(root).as_posix())
    # Stable order, no duplicates.
    seen = set()
    ordered = []
    for rel in found:
        if rel not in seen:
            seen.add(rel)
            ordered.append(rel)
    return ordered


def _aad(rel: str) -> bytes:
    return rel.encode("utf-8")


def encrypt_tree(root: Path, key: bytes) -> list[str]:
    paths = _engine_paths(root)
    if not paths:
        raise SystemExit("No engine files found to encrypt.")
    records = []
    for rel in paths:
        src = root / rel
        plaintext = src.read_bytes()
        blob = encrypt_bytes(key, plaintext, _aad(rel))
        enc_rel = f"protected/{rel}.enc"
        dest = root / enc_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
        records.append({
            "path": rel,
            "enc": enc_rel,
            "sha256": hashlib.sha256(plaintext).hexdigest(),
            "bytes": len(plaintext),
        })
    manifest = {
        "version": 1,
        "scheme": "AES-256-GCM",
        "files": records,
    }
    manifest_path = root / MANIFEST_NAME
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return [item["path"] for item in records]


def decrypt_tree(root: Path, key: bytes) -> list[str]:
    manifest_path = root / MANIFEST_NAME
    if not manifest_path.is_file():
        raise SystemExit(f"Missing {MANIFEST_NAME}. Encrypt the engine first.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    written = []
    for item in manifest.get("files") or []:
        rel = str(item["path"])
        blob = (root / str(item["enc"])).read_bytes()
        plain = decrypt_bytes(key, blob, _aad(rel))
        expected = item.get("sha256")
        if expected and hashlib.sha256(plain).hexdigest() != expected:
            raise EngineCryptoError(f"Hash mismatch after decrypting {rel}.")
        dest = root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(plain)
        written.append(rel)
    return written


def _is_key_path(name: str) -> bool:
    base = Path(name).name
    if base in KEY_FILENAMES or name.endswith(".smart_shield_key"):
        return True
    if name.startswith("protected/") and base.endswith(".key"):
        return True
    return False


def _is_engine_path(name: str) -> bool:
    if name in ENGINE_SOURCES:
        return True
    return any(fnmatch.fnmatch(name, pattern) for pattern in MODEL_GLOBS)


def check_staged(names: list[str], manifest_exists: bool) -> list[str]:
    """Return human-readable errors. An empty list means the commit may proceed."""
    errors = []
    for name in names:
        if _is_key_path(name):
            errors.append(f"Refusing to commit a key file: {name}")
        elif manifest_exists and _is_engine_path(name):
            errors.append(
                f"Refusing to commit plaintext engine file {name} while {MANIFEST_NAME} exists. "
                "Keep the ciphertext in protected/ and leave this file untracked."
            )
    return errors


def _git_staged(root: Path) -> list[str]:
    try:
        out = subprocess.run(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"Could not read the git index: {exc}") from exc
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def _read_key(root: Path) -> bytes:
    try:
        return load_key(root)
    except EngineCryptoError as exc:
        raise SystemExit(str(exc)) from exc


def _refuse_key_out(root: Path, out: Path) -> None:
    """A key file must stay gitignored. Never write one inside protected/."""
    try:
        rel = out.resolve().relative_to(root.resolve()).as_posix()
    except ValueError as exc:
        raise SystemExit("Refusing to write a key outside the repository.") from exc
    if not _is_key_path(rel) and out.name not in KEY_FILENAMES:
        raise SystemExit("Refusing to write a key outside a .smart_shield_key filename.")
    try:
        check = subprocess.run(
            ["git", "check-ignore", "-q", rel],
            cwd=root,
            check=False,
        )
    except OSError as exc:
        raise SystemExit(f"Could not ask git whether {rel} is ignored: {exc}") from exc
    if check.returncode != 0:
        raise SystemExit(f"Refusing to write {rel} because it is not gitignored.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Protect the Enterprise scoring engine at rest.")
    parser.add_argument("command", choices=("keygen", "encrypt", "decrypt", "check"))
    parser.add_argument("--root", type=Path, default=ROOT, help="Repository root. Tests use a temp copy.")
    parser.add_argument("--out", type=Path, help="keygen only: write the key to this gitignored file.")
    args = parser.parse_args(argv)
    root = args.root.resolve()

    if args.command == "keygen":
        key = generate_key()
        if args.out:
            dest = args.out if args.out.is_absolute() else root / args.out
            _refuse_key_out(root, dest)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(key + "\n", encoding="utf-8")
            print(f"Wrote a new key to {dest}. It is gitignored. Back it up outside the repo.")
        else:
            print(key)
        return 0

    if args.command == "encrypt":
        written = encrypt_tree(root, _read_key(root))
        print(f"Encrypted {len(written)} engine file(s) into protected/.")
        print("Plaintext is still on disk. When you are ready, remove it from git tracking.")
        print("See PROTECTING_IP.md. Do not commit the key.")
        return 0

    if args.command == "decrypt":
        written = decrypt_tree(root, _read_key(root))
        print(f"Restored {len(written)} plaintext engine file(s).")
        return 0

    errors = check_staged(_git_staged(root), (root / MANIFEST_NAME).is_file())
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("Engine protection check passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except EngineCryptoError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
