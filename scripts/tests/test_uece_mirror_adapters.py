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
            first_text = "VESTIBULAR 2026.1 1ª FASE PROVA DE CONHECIMENTOS GERAIS. O gabarito oficial será divulgado posteriormente."
            leaf = "vtb20261f1g1.pdf"
            page_count = 24
            sha256 = "x"
        self.assertTrue(ingest.is_exam(Document()))

    def test_exam_can_be_identified_by_expected_count_when_cover_wording_changes(self) -> None:
        class Document:
            first_text = "UNIVERSIDADE ESTADUAL DO CEARÁ VESTIBULAR 2025.1 1ª FASE. Este caderno contém 85 questões objetivas."
            leaf = "prova-01.pdf"
            page_count = 20
            sha256 = "y"
        self.assertTrue(ingest.is_exam(Document()))

    def test_declared_question_count_wins_over_structural_noise(self) -> None:
        class Document:
            first_text = "VESTIBULAR 2024.1 1ª FASE. Este Caderno de Prova contém 85 questões."
            leaf = "prova-gabarito-1.pdf"
            page_count = 25
            sha256 = "declared-count"

        document = Document()
        ingest.STRUCTURAL_EXPECTED[document.sha256] = 87
        try:
            self.assertEqual(ingest.expected(document), 85)
        finally:
            ingest.STRUCTURAL_EXPECTED.pop(document.sha256, None)

    def test_structural_count_is_fallback_when_cover_count_is_missing(self) -> None:
        class Document:
            first_text = "UNIVERSIDADE ESTADUAL DO CEARÁ VESTIBULAR 2024.1"
            leaf = "legacy-prova.pdf"
            page_count = 20
            sha256 = "structural-fallback"

        document = Document()
        ingest.STRUCTURAL_EXPECTED[document.sha256] = 40
        try:
            self.assertEqual(ingest.expected(document), 40)
        finally:
            ingest.STRUCTURAL_EXPECTED.pop(document.sha256, None)

    def test_short_answer_key_is_not_misclassified_as_exam(self) -> None:
        class Document:
            first_text = "VESTIBULAR 2026.1 1ª FASE GABARITO OFICIAL CONHECIMENTOS GERAIS"
            leaf = "gabarito-preliminar.pdf"
            page_count = 3
            sha256 = "z"
        self.assertFalse(ingest.is_exam(Document()))

    def test_flexible_key_parser_prefers_english_gabarito_one(self) -> None:
        text = """
        LÍNGUA ESPANHOLA
        GABARITO 1
        01 02 03 04 05 06
        A A A A A A
        GABARITO 2
        01 02 03 04 05 06
        B B B B B B
        LÍNGUA INGLESA
        GABARITO 1
        01 02 03 04 05 06
        B C D A B C
        GABARITO 2
        01 02 03 04 05 06
        C D A B C D
        """
        answers = ingest.parse_key_text(text, 6)
        self.assertEqual(answers, {1: "B", 2: "C", 3: "D", 4: "A", 5: "B", 6: "C"})

    def test_flexible_key_parser_accepts_inline_number_answer_pairs(self) -> None:
        text = """
        LÍNGUA INGLESA
        GABARITO 1
        01 B 02 C 03 D 04 A 05 B 06 C
        GABARITO 2
        01 C 02 D 03 A 04 B 05 C 06 D
        """
        answers = ingest.parse_key_text(text, 6)
        self.assertEqual(answers, {1: "B", 2: "C", 3: "D", 4: "A", 5: "B", 6: "C"})

    def test_tabular_key_uses_gabarito_one_and_english_duplicate_rows(self) -> None:
        text = """
        Questão Disciplina Gab. 1 Gab. 2 Gab. 3 Gab. 4 Questão Disciplina Gab. 1 Gab. 2 Gab. 3 Gab. 4
        1 Língua Portuguesa C B D A 2 Matemática D A C B
        3 Língua Espanhola A B C D
        3 Língua Francesa B C D A
        3 Língua Inglesa D C A B
        """
        self.assertEqual(ingest.parse_key_text(text, 3), {1: "C", 2: "D", 3: "D"})

    def test_ead_source_is_not_mixed_into_regular_cycle(self) -> None:
        class Source:
            title = "Provas e gabaritos UECE EaD 2023"
            path = Path("provas-e-gabaritos-uece-ead-2023.rar")
        self.assertEqual(ingest._source_variant(Source()), "ead")

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