from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPTS = Path(__file__).parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

OCR_SPEC = importlib.util.spec_from_file_location("native_ocr_markers", SCRIPTS / "native_ocr_markers.py")
assert OCR_SPEC and OCR_SPEC.loader
ocr = importlib.util.module_from_spec(OCR_SPEC)
sys.modules[OCR_SPEC.name] = ocr
OCR_SPEC.loader.exec_module(ocr)

PIPELINE_SPEC = importlib.util.spec_from_file_location("native_pipeline_for_ocr_test", SCRIPTS / "native_pipeline.py")
assert PIPELINE_SPEC and PIPELINE_SPEC.loader
pipeline = importlib.util.module_from_spec(PIPELINE_SPEC)
sys.modules[PIPELINE_SPEC.name] = pipeline
PIPELINE_SPEC.loader.exec_module(pipeline)


class FakeTextPage:
    def __init__(self, blocks):
        self.blocks = blocks

    def extractBLOCKS(self):
        return self.blocks


class FakePage:
    def __init__(self, blocks=None, error: Exception | None = None):
        self.blocks = blocks or []
        self.error = error

    def get_textpage_ocr(self, **_kwargs):
        if self.error:
            raise self.error
        return FakeTextPage(self.blocks)


class NativeOcrMarkerTests(unittest.TestCase):
    def test_detects_question_markers_from_ocr_blocks(self):
        markers = ocr.detect_markers(
            [
                FakePage([(10, 20, 200, 40, "Questão 1. Texto", 0, 0)]),
                FakePage([(10, 50, 200, 70, "Questao 02. Outro texto", 0, 0)]),
            ],
            pipeline.DEFAULT_MARKER,
            pipeline.Marker,
        )

        self.assertEqual([marker.number for marker in markers], [1, 2])
        self.assertEqual([marker.page_index for marker in markers], [0, 1])

    def test_ocr_failure_is_explicit(self):
        with self.assertRaisesRegex(ocr.NativeOcrMarkerError, "OCR indisponível"):
            ocr.detect_markers(
                [FakePage(error=RuntimeError("tesseract not found"))],
                pipeline.DEFAULT_MARKER,
                pipeline.Marker,
            )

    def test_pipeline_gate_still_rejects_missing_ocr_markers(self):
        markers = ocr.detect_markers(
            [FakePage([(10, 20, 200, 40, "Questão 1. Texto", 0, 0)])],
            pipeline.DEFAULT_MARKER,
            pipeline.Marker,
        )

        with self.assertRaisesRegex(pipeline.NativePipelineError, "faltantes"):
            pipeline.validate_marker_numbers(markers, 2)


if __name__ == "__main__":
    unittest.main()
