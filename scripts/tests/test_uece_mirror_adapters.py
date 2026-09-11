from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


harvest = load("harvest_uece_mirror", "harvest-uece-brasil-escola.py")
ingest = load("ingest_uece_mirror", "ingest-uece-mirror.py")


class UeceMirrorAdapterTests(unittest.TestCase):
    def test_detects_zip_pdf_and_rar_by_bytes(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("x.txt", "x")
        self.assertEqual(harvest.detect_extension(buffer.getvalue()), ".zip")
        self.assertEqual(harvest.detect_extension(b"%PDF-1.7\nsynthetic"), ".pdf")
        self.assertEqual(harvest.detect_extension(b"Rar!\x1a\x07\x01\x00synthetic"), ".rar")

    def test_exam_can_mention_official_answer_key_in_instructions(self) -> None:
        class Document:
            first_text = (
                "VESTIBULAR 2026.1 1ª FASE PROVA DE CONHECIMENTOS GERAIS. "
                "O gabarito oficial será divulgado posteriormente."
            )
            leaf = "vtb20261f1g1.pdf"
            page_count = 24

        self.assertTrue(ingest.is_exam(Document()))

    def test_short_answer_key_is_not_misclassified_as_exam(self) -> None:
        class Document:
            first_text = "VESTIBULAR 2026.1 1ª FASE GABARITO OFICIAL CONHECIMENTOS GERAIS"
            leaf = "gabarito-preliminar.pdf"
            page_count = 3

        self.assertFalse(ingest.is_exam(Document()))

    def test_recursive_inputs_include_direct_pdf_and_stage_rar(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nested = root / "uece" / "2025"
            nested.mkdir(parents=True)
            for name in ("exam.pdf", "bundle.zip", "legacy.rar"):
                (nested / name).write_bytes(b"x")
            (nested / "ignore.txt").write_text("x", encoding="utf-8")
            paths = ingest.inputs([str(root)])
            self.assertEqual({path.suffix for path in paths}, {".pdf", ".zip", ".rar"})


if __name__ == "__main__":
    unittest.main()
