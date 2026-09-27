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


class UnlockedImportTests(unittest.TestCase):
    def test_decrypted_tree_can_import_plaintext_live_helpers(self):
        """Mirror inference.py: it puts <decrypt>/src first, then imports Live_alerts.

        Those helpers are not part of the encrypted engine. They live in the
        repository src tree. The loader has to leave that tree on sys.path.
        """
        import importlib
        import tempfile

        from engine_loader import _keep_repo_src_importable

        probe_name = "inference_live_probe"
        with tempfile.TemporaryDirectory(prefix="smart-shield-engine-") as tmp:
            root = Path(tmp)
            demo = root / "demo"
            src = root / "src"
            demo.mkdir()
            src.mkdir()
            (src / "nlp_brain.py").write_text("MARKER = 'temp-engine'\n", encoding="utf-8")
            (demo / f"{probe_name}.py").write_text(
                "import sys\n"
                "from pathlib import Path\n"
                "_SRC = Path(__file__).resolve().parent.parent / 'src'\n"
                "if str(_SRC) not in sys.path:\n"
                "    sys.path.insert(0, str(_SRC))\n"
                "from nlp_brain import MARKER\n"
                "from Live_alerts import nearby_alert_text\n"
                "from Live_weather import live_risk_components\n"
                "from Live_cameras import fetch_nearby_still\n",
                encoding="utf-8",
            )
            before_path = list(sys.path)
            before_modules = set(sys.modules)
            try:
                sys.path.insert(0, str(demo))
                sys.path.insert(0, str(src))
                _keep_repo_src_importable(ROOT)
                module = importlib.import_module(probe_name)
                self.assertEqual(module.MARKER, "temp-engine")
                self.assertTrue(callable(module.nearby_alert_text))
                self.assertTrue(callable(module.live_risk_components))
                self.assertTrue(callable(module.fetch_nearby_still))
                self.assertIn(str((ROOT / "src").resolve()), sys.path)
                self.assertNotEqual(
                    Path(module.nearby_alert_text.__code__.co_filename).resolve().parent,
                    src.resolve(),
                )
            finally:
                sys.path[:] = before_path
                for name in list(sys.modules):
                    if name not in before_modules:
                        sys.modules.pop(name, None)

    def test_decrypted_tree_sees_repository_models_and_cache(self):
        import tempfile

        from engine_loader import _share_repo_assets

        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            tree = Path(tmp) / "smart-shield-engine-test"
            (repo / "models").mkdir(parents=True)
            (repo / "models" / "rf_tuned.joblib").write_bytes(b"trained-rf")
            (repo / "Data" / "vision_cache" / "clear").mkdir(parents=True)
            (repo / "Data" / "vision_cache" / "clear" / "road.jpg").write_bytes(b"jpeg")
            (tree / "demo").mkdir(parents=True)
            (tree / "models").mkdir()
            (tree / "models" / "vision_meta.json").write_text("{}", encoding="utf-8")

            _share_repo_assets(repo, tree)

            models = (tree / "demo").resolve().parent / "models"
            cache = (tree / "demo").resolve().parent / "Data" / "vision_cache"
            self.assertTrue((models / "rf_tuned.joblib").is_file())
            self.assertEqual((models / "rf_tuned.joblib").read_bytes(), b"trained-rf")
            self.assertTrue((models / "vision_meta.json").is_file())
            self.assertEqual((repo / "models" / "vision_meta.json").read_text(), "{}")
            self.assertTrue((cache / "clear" / "road.jpg").is_file())
            self.assertTrue(models.is_symlink())
            self.assertEqual(models.resolve(), (repo / "models").resolve())

    def test_unlock_keeps_repository_src_on_path(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = "demo/ss_path_probe.py"
            (root / "demo").mkdir()
            (root / "src").mkdir()
            (root / rel).write_text("VALUE = 'unlocked-path'\n", encoding="utf-8")
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
            before_path = list(sys.path)
            before_modules = set(sys.modules)
            try:
                opened = prepare_engine(
                    root, sources=[rel], environ={"SMART_SHIELD_KEY": key_text}
                )
                self.assertEqual(opened["mode"], "unlocked")
                self.assertIn(str((root / "src").resolve()), sys.path)
                import ss_path_probe
                self.assertEqual(ss_path_probe.VALUE, "unlocked-path")
            finally:
                sys.path[:] = before_path
                for name in list(sys.modules):
                    if name not in before_modules:
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
