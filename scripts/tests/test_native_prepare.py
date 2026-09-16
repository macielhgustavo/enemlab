from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS = Path(__file__).parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

PREPARE_SPEC = importlib.util.spec_from_file_location("native_prepare", SCRIPTS / "native_prepare.py")
assert PREPARE_SPEC and PREPARE_SPEC.loader
native_prepare = importlib.util.module_from_spec(PREPARE_SPEC)
sys.modules[PREPARE_SPEC.name] = native_prepare
PREPARE_SPEC.loader.exec_module(native_prepare)

PIPELINE_SPEC = importlib.util.spec_from_file_location("native_pipeline_profile_test", SCRIPTS / "native_pipeline.py")
assert PIPELINE_SPEC and PIPELINE_SPEC.loader
native_pipeline = importlib.util.module_from_spec(PIPELINE_SPEC)
sys.modules[PIPELINE_SPEC.name] = native_pipeline
PIPELINE_SPEC.loader.exec_module(native_pipeline)


class FakePage:
    def __init__(self, blocks):
        self.blocks = blocks

    def get_text(self, kind, sort=False):
        if kind == "blocks":
            return self.blocks
        raise AssertionError(f"unexpected get_text kind: {kind}")


class NativePrepareProfileTests(unittest.TestCase):
    def test_eear_profile_uses_line_leading_numeric_marker(self):
        target = next(
            target
            for target in native_prepare.ingest.discover_targets()
            if target.provider_id == "eear" and target.edition_id == "2023-eags-administracao"
        )
        profiled = native_prepare.apply_layout_profile(target)
        self.assertEqual(profiled.marker_pattern, native_prepare.EEAR_MARKER_PATTERN)

    def test_default_provider_is_not_modified(self):
        target = next(
            target
            for target in native_prepare.ingest.discover_targets()
            if target.provider_id == "unesp" and target.year == 2026 and target.phase == "first"
        )
        self.assertIs(native_prepare.apply_layout_profile(target), target)

    def test_eear_marker_ignores_answer_key_prose_and_detects_real_questions(self):
        page = FakePage(
            [
                (10, 10, 500, 40, "21 A Solicitar recurso dessa questão 22 C Solicitar recurso dessa questão", 0, 0),
                (10, 60, 500, 100, "01 – Avalie as informações abaixo acerca do texto.\n02 – Quanto às ideias presentes...", 0, 0),
            ]
        )
        markers = native_pipeline.detect_markers([page], native_prepare.EEAR_MARKER_PATTERN)
        self.assertEqual([marker.number for marker in markers], [1, 2])

    def test_eear_marker_accepts_common_dash_variants(self):
        page = FakePage(
            [
                (10, 10, 500, 80, "01 - Primeira\n02 – Segunda\n03 — Terceira\n10 – Décima\n100 – Centésima", 0, 0),
            ]
        )
        markers = native_pipeline.detect_markers([page], native_prepare.EEAR_MARKER_PATTERN)
        self.assertEqual([marker.number for marker in markers], [1, 2, 3, 10, 100])

    def test_eear_marker_rejects_internal_single_digit_numbered_lists(self):
        page = FakePage(
            [
                (10, 10, 500, 100, "1 – Receita\n2 – Despesa\n3 - Terceiro item\n4 — Quarto item", 0, 0),
                (10, 120, 500, 160, "01 – Questão real\n02 – Outra questão real", 0, 0),
            ]
        )
        markers = native_pipeline.detect_markers([page], native_prepare.EEAR_MARKER_PATTERN)
        self.assertEqual([marker.number for marker in markers], [1, 2])


class NativePreparePinnedSourceTests(unittest.TestCase):
    def target(self, output: Path):
        return SimpleNamespace(
            provider_id="ime",
            year=2026,
            edition_id="2025-2026",
            phase="first",
            identity="ime:2025-2026:first",
            exam_url="https://official.example/prova.pdf",
            output_dir=output,
        )

    def write_catalog(self, root: Path, record: dict) -> None:
        path = root / "ime" / "answer-keys.generated.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"2025-2026": record}), encoding="utf-8")

    def test_matching_pinned_archive_is_accepted(self):
        payload = b"%PDF-1.7\nverified fixture\n%%EOF\n"
        digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            providers = temp_path / "providers"
            output = temp_path / "out"
            target = self.target(output)
            archive = "https://web.archive.org/web/20260909011213id_/" + target.exam_url
            self.write_catalog(
                providers,
                {
                    "examArchiveUrl": archive,
                    "examSha256": digest,
                    "examBytes": len(payload),
                },
            )

            def fake_download(url: str, destination: Path):
                self.assertEqual(url, archive)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(payload)
                return destination

            with patch.object(native_prepare.core, "PROVIDERS", providers), patch.object(
                native_prepare.core, "_download_pdf", side_effect=fake_download
            ):
                result = native_prepare._verified_pdf_override(target)

            self.assertEqual(result, output / "source-pinned.pdf")
            self.assertEqual(result.read_bytes(), payload)

    def test_wrong_digest_fails_closed_and_leaves_no_pdf(self):
        payload = b"%PDF-1.7\nwrong fixture\n%%EOF\n"
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            providers = temp_path / "providers"
            output = temp_path / "out"
            target = self.target(output)
            archive = "https://web.archive.org/web/20260909011213id_/" + target.exam_url
            self.write_catalog(
                providers,
                {
                    "examArchiveUrl": archive,
                    "examSha256": "0" * 64,
                    "examBytes": len(payload),
                },
            )

            def fake_download(_url: str, destination: Path):
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(payload)
                return destination

            with patch.object(native_prepare.core, "PROVIDERS", providers), patch.object(
                native_prepare.core, "_download_pdf", side_effect=fake_download
            ):
                with self.assertRaises(native_prepare.fleet.NativeFleetError):
                    native_prepare._verified_pdf_override(target)

            self.assertFalse((output / "source-pinned.pdf").exists())
            self.assertFalse((output / "source-pinned.tmp").exists())

    def test_snapshot_must_wrap_exact_official_url(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            providers = temp_path / "providers"
            target = self.target(temp_path / "out")
            self.write_catalog(
                providers,
                {
                    "examArchiveUrl": "https://web.archive.org/web/20260909011213id_/https://other.example/prova.pdf",
                    "examSha256": "a" * 64,
                    "examBytes": 123,
                },
            )
            with patch.object(native_prepare.core, "PROVIDERS", providers):
                with self.assertRaises(native_prepare.fleet.NativeFleetError):
                    native_prepare._pinned_archive_metadata(target)

    def test_partial_integrity_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            providers = temp_path / "providers"
            target = self.target(temp_path / "out")
            self.write_catalog(
                providers,
                {
                    "examArchiveUrl": "https://web.archive.org/web/20260909011213id_/" + target.exam_url,
                    "examSha256": "a" * 64,
                },
            )
            with patch.object(native_prepare.core, "PROVIDERS", providers):
                with self.assertRaises(native_prepare.fleet.NativeFleetError):
                    native_prepare._pinned_archive_metadata(target)

    def test_provider_without_pinned_metadata_keeps_default_source_path(self):
        target = SimpleNamespace(
            provider_id="unesp",
            year=2026,
            edition_id=None,
            phase="first",
            identity="unesp:2026:first",
            exam_url="https://official.example/unesp.pdf",
            output_dir=Path("/tmp/unused"),
        )
        self.assertIsNone(native_prepare._pinned_archive_metadata(target))


if __name__ == "__main__":
    unittest.main()
