from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

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
                (10, 10, 500, 80, "01 - Primeira\n02 – Segunda\n03 — Terceira", 0, 0),
            ]
        )
        markers = native_pipeline.detect_markers([page], native_prepare.EEAR_MARKER_PATTERN)
        self.assertEqual([marker.number for marker in markers], [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
