"""AES-256-GCM framing for Enterprise engine files.

The key is 32 random bytes, stored as url-safe base64 in ``SMART_SHIELD_KEY``
or a gitignored ``.smart_shield_key`` file. Each ciphertext is bound to its
repo-relative path so two files cannot be swapped.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path

MAGIC = b"SSENC1"
NONCE_LEN = 12
KEY_LEN = 32


class EngineCryptoError(Exception):
    """A key or ciphertext problem. Callers turn this into a locked engine."""


def generate_key() -> str:
    """Return a new url-safe base64 key. Nothing is written to disk."""
    return base64.urlsafe_b64encode(os.urandom(KEY_LEN)).decode("ascii")


def decode_key(text: str) -> bytes:
    raw = (text or "").strip()
    if not raw:
        raise EngineCryptoError("Engine locked. Set SMART_SHIELD_KEY to unlock scoring.")
    try:
        key = base64.urlsafe_b64decode(raw.encode("ascii"))
    except Exception as exc:
        raise EngineCryptoError("SMART_SHIELD_KEY is not valid url-safe base64.") from exc
    if len(key) != KEY_LEN:
        raise EngineCryptoError("SMART_SHIELD_KEY must decode to 32 bytes.")
    return key


def load_key(root: Path, environ: dict | None = None) -> bytes:
    """Read the key from the environment, then from a gitignored local file."""
    env = os.environ if environ is None else environ
    text = (env.get("SMART_SHIELD_KEY") or "").strip()
    if not text:
        for name in (".smart_shield_key", "demo/.smart_shield_key"):
            path = root / name
            if path.is_file():
                text = path.read_text(encoding="utf-8")
                break
    return decode_key(text)


def encrypt_bytes(key: bytes, plaintext: bytes, aad: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(NONCE_LEN)
    token = AESGCM(key).encrypt(nonce, plaintext, aad)
    return MAGIC + nonce + token


def decrypt_bytes(key: bytes, blob: bytes, aad: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if not blob.startswith(MAGIC) or len(blob) < len(MAGIC) + NONCE_LEN + 16:
        raise EngineCryptoError("Encrypted engine file is not in the expected format.")
    nonce = blob[len(MAGIC) : len(MAGIC) + NONCE_LEN]
    token = blob[len(MAGIC) + NONCE_LEN :]
    try:
        return AESGCM(key).decrypt(nonce, token, aad)
    except Exception as exc:
        raise EngineCryptoError("Could not decrypt the engine. Check SMART_SHIELD_KEY.") from exc
