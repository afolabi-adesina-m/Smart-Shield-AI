"""Encryption tooling and the locked-engine fallback. Uses a temporary key only."""

from __future__ import annotations

import hashlib
import json
import sys
import unittest
from pathlib import Path

DEMO_DIR = Path(__file__).resolve().parent
ROOT = DEMO_DIR.parent
if str(DEMO_DIR) not in sys.path:
    sys.path.insert(0, str(DEMO_DIR))

from engine_crypto import (  # noqa: E402
    EngineCryptoError,
    decrypt_bytes,
    encrypt_bytes,
    generate_key,
)
from engine_loader import (  # noqa: E402
    _locked_safe_speed,
    _locked_score_routes,
    prepare_engine,
)


def _import_protect():
    tool = ROOT / "tools" / "protect.py"
    import importlib.util

    spec = importlib.util.spec_from_file_location("protect_tool", tool)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class KeyTests(unittest.TestCase):
    def test_keygen_is_32_bytes(self):
        text = generate_key()
        self.assertNotIn("\n", text)
        raw = encode_roundtrip_key(text)
        self.assertEqual(len(raw), 32)

    def test_roundtrip_and_wrong_key(self):
        key = encode_roundtrip_key(generate_key())
        other = encode_roundtrip_key(generate_key())
        blob = encrypt_bytes(key, b"fusion-weights", b"src/safety_score.py")
        self.assertEqual(decrypt_bytes(key, blob, b"src/safety_score.py"), b"fusion-weights")
        with self.assertRaises(EngineCryptoError):
            decrypt_bytes(other, blob, b"src/safety_score.py")
        with self.assertRaises(EngineCryptoError):
            decrypt_bytes(key, blob, b"demo/inference.py")


class TreeTests(unittest.TestCase):
    def test_encrypt_decrypt_tree(self):
        import tempfile

        protect = _import_protect()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = "src/safety_score.py"
            body = b"def fuse():\n    return 1\n"
            (root / "src").mkdir()
            (root / rel).write_bytes(body)
            key = encode_roundtrip_key(generate_key())
            written = protect.encrypt_tree(root, key)
            self.assertEqual(written, [rel])
            enc = root / "protected" / f"{rel}.enc"
            self.assertTrue(enc.is_file())
            self.assertNotIn(b"def fuse", enc.read_bytes())
            (root / rel).unlink()
            restored = protect.decrypt_tree(root, key)
            self.assertEqual(restored, [rel])
            self.assertEqual((root / rel).read_bytes(), body)

    def test_missing_key_message(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = "demo/ss_probe.py"
            (root / "demo").mkdir()
            (root / rel).write_text("def marker():\n    return 'enterprise-engine'\n", encoding="utf-8")
            plain = (root / rel).read_bytes()
            key_text = generate_key()
            key = encode_roundtrip_key(key_text)
            enc_rel = f"protected/{rel}.enc"
            dest = root / enc_rel
            dest.parent.mkdir(parents=True)
            dest.write_bytes(encrypt_bytes(key, plain, rel.encode()))
            manifest = {
                "version": 1,
                "scheme": "AES-256-GCM",
                "files": [{
                    "path": rel,
                    "enc": enc_rel,
                    "sha256": hashlib.sha256(plain).hexdigest(),
                }],
            }
            (root / "protected" / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (root / rel).unlink()

            before = set(sys.modules)
            try:
                locked = prepare_engine(root, sources=[rel], environ={})
                self.assertEqual(locked["mode"], "locked")
                self.assertIn("Engine locked", locked["message"])
                self.assertTrue(locked["locked"])

                opened = prepare_engine(
                    root, sources=[rel], environ={"SMART_SHIELD_KEY": key_text}
                )
                self.assertEqual(opened["mode"], "unlocked")
                import ss_probe
                self.assertEqual(ss_probe.marker(), "enterprise-engine")
            finally:
                sys.path[:] = [item for item in sys.path if "smart-shield-engine-" not in item]
                sys.modules.pop("ss_probe", None)
                for name in ("inference", "vision_runtime", "speed_limit", "road_rules"):
                    if name not in before:
                        sys.modules.pop(name, None)


class FallbackTests(unittest.TestCase):
    def test_locked_scoring_is_not_a_model_score(self):
        rows = _locked_score_routes([{"distance_m": 1000, "duration_s": 60, "summary": "401"}])
        self.assertEqual(rows[0]["tier"], "LOCKED")
        self.assertIsNone(rows[0]["safety_score"])
        self.assertIn("Engine locked", rows[0]["operational_message"])
        safe = _locked_safe_speed(100, highway="motorway", weather="ice_storm")
        self.assertEqual(safe["safe_kmh"], 100)
        self.assertEqual(safe["source"], "engine_locked")

    def test_real_repo_stays_plaintext(self):
        status = prepare_engine()
        self.assertEqual(status["mode"], "plaintext")
        self.assertFalse(status["locked"])

    def test_check_blocks_keys_and_plaintext_after_manifest(self):
        check_staged = _import_protect().check_staged
        self.assertEqual(check_staged(["README.md"], manifest_exists=False), [])
        self.assertEqual(check_staged(["src/safety_score.py"], manifest_exists=False), [])
        key_errors = check_staged([".smart_shield_key"], manifest_exists=False)
        self.assertTrue(key_errors)
        plain_errors = check_staged(
            ["demo/speed_limit.py", "models/rf_tuned.joblib"],
            manifest_exists=True,
        )
        self.assertEqual(len(plain_errors), 2)


def encode_roundtrip_key(text: str) -> bytes:
    from engine_crypto import decode_key
    return decode_key(text)


if __name__ == "__main__":
    unittest.main()
