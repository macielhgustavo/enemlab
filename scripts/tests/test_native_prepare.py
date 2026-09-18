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


class NativeImePrepareTests(unittest.TestCase):
    def test_shared_context_resolution_clears_visual_dependency_issue(self):
        pages = [
            SimpleNamespace(rect=SimpleNamespace(width=600.0, height=840.0)),
            SimpleNamespace(rect=SimpleNamespace(width=600.0, height=840.0)),
        ]
        groups = [
            native_prepare.ime_prepare.option_markers.OptionGroup(
                0, "ordered-lines", 40.0, 100.0, 500.0, 300.0
            ),
            native_prepare.ime_prepare.option_markers.OptionGroup(
                1, "ordered-lines", 40.0, 100.0, 500.0, 300.0
            ),
        ]
        full_region = {
            "page": 1,
            "role": "question",
            "rect": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
        }
        pack = {
            "questions": [
                {
                    "number": 1,
                    "visualRegions": [full_region],
                    "extraction": {
                        "issues": [],
                        "visualCompleteness": {
                            "required": False,
                            "resolved": True,
                            "reasons": [],
                        },
                    },
                },
                {
                    "number": 2,
                    "visualRegions": [
                        {
                            "page": 2,
                            "role": "question",
                            "rect": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
                        }
                    ],
                    "extraction": {
                        "issues": [
                            "dependência visual/contextual não resolvida automaticamente: media:chart"
                        ],
                        "visualCompleteness": {
                            "required": True,
                            "resolved": False,
                            "reasons": ["media:chart"],
                        },
                    },
                },
            ]
        }

        def normalized(rect, page):
            x0, y0, x1, y1 = rect
            return {
                "x": x0 / page.rect.width,
                "y": y0 / page.rect.height,
                "width": (x1 - x0) / page.rect.width,
                "height": (y1 - y0) / page.rect.height,
            }

        result = native_prepare.ime_prepare._decorate(
            pack,
            pages,
            groups,
            SimpleNamespace(_normalized_rect=normalized),
            RuntimeError,
        )

        extraction = result["questions"][1]["extraction"]
        self.assertEqual(extraction["issues"], [])
        self.assertTrue(extraction["visualCompleteness"]["resolved"])
        self.assertEqual(extraction["visualCompleteness"]["strategy"], "shared-context")
        self.assertIn(
            "layout:ordered-option-page-transition",
            extraction["visualCompleteness"]["reasons"],
        )


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

    def write_audit(self, root: Path, record: dict, *, provider: str = "ime", schema: int = 1) -> None:
        path = root / "ime" / native_prepare.SOURCE_AUDIT_FILENAME
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "schemaVersion": schema,
                    "provider": provider,
                    "auditRevision": "fixture@1",
                    "records": {"2025-2026": record},
                }
            ),
            encoding="utf-8",
        )

    def audited_record(self, target, archive: str, digest: str, byte_length: int) -> dict:
        return {
            "examUrl": target.exam_url,
            "examArchiveUrl": archive,
            "examSha256": digest,
            "examBytes": byte_length,
        }

    def test_matching_pinned_archive_is_accepted(self):
        payload = b"%PDF-1.7\nverified fixture\n%%EOF\n"
        digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            providers = temp_path / "providers"
            output = temp_path / "out"
            target = self.target(output)
            archive = "https://web.archive.org/web/20260909011213id_/" + target.exam_url
            self.write_audit(providers, self.audited_record(target, archive, digest, len(payload)))

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
            self.write_audit(
                providers,
                self.audited_record(target, archive, "0" * 64, len(payload)),
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
            self.write_audit(
                providers,
                self.audited_record(
                    target,
                    "https://web.archive.org/web/20260909011213id_/https://other.example/prova.pdf",
                    "a" * 64,
                    123,
                ),
            )
            with patch.object(native_prepare.core, "PROVIDERS", providers):
                with self.assertRaises(native_prepare.fleet.NativeFleetError):
                    native_prepare._pinned_archive_metadata(target)

    def test_audited_official_url_must_match_executable_catalog(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            providers = temp_path / "providers"
            target = self.target(temp_path / "out")
            archive = "https://web.archive.org/web/20260909011213id_/" + target.exam_url
            record = self.audited_record(target, archive, "a" * 64, 123)
            record["examUrl"] = "https://official.example/outra-prova.pdf"
            self.write_audit(providers, record)
            with patch.object(native_prepare.core, "PROVIDERS", providers):
                with self.assertRaises(native_prepare.fleet.NativeFleetError):
                    native_prepare._pinned_archive_metadata(target)

    def test_partial_integrity_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            providers = temp_path / "providers"
            target = self.target(temp_path / "out")
            self.write_audit(
                providers,
                {
                    "examUrl": target.exam_url,
                    "examArchiveUrl": "https://web.archive.org/web/20260909011213id_/" + target.exam_url,
                    "examSha256": "a" * 64,
                },
            )
            with patch.object(native_prepare.core, "PROVIDERS", providers):
                with self.assertRaises(native_prepare.fleet.NativeFleetError):
                    native_prepare._pinned_archive_metadata(target)

    def test_manifest_provider_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            providers = temp_path / "providers"
            target = self.target(temp_path / "out")
            archive = "https://web.archive.org/web/20260909011213id_/" + target.exam_url
            self.write_audit(
                providers,
                self.audited_record(target, archive, "a" * 64, 123),
                provider="afa",
            )
            with patch.object(native_prepare.core, "PROVIDERS", providers):
                with self.assertRaises(native_prepare.fleet.NativeFleetError):
                    native_prepare._source_audit_record(target)

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
