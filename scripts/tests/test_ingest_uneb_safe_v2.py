from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-uneb-safe-v2.py"
spec = importlib.util.spec_from_file_location("ingest_uneb_safe_v2_tested", SCRIPT)
assert spec and spec.loader
uneb_v2 = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = uneb_v2
spec.loader.exec_module(uneb_v2)
core = uneb_v2.core


class IngestUnebSafeV2Tests(unittest.TestCase):
    def test_explicit_annulment_is_preserved(self):
        pages = ["""
Este caderno é composto por 01 (uma) questões objetivas.
Questão 01
(Questão anulada)
Enunciado válido.
(A) alternativa a
(B) alternativa b
(C) alternativa c
(D) alternativa d
(E) alternativa e
"""]
        questions, expected = uneb_v2.parse_inline_text(pages)
        self.assertEqual(expected, 1)
        self.assertEqual(questions[1].correct, "X")
        self.assertTrue(questions[1].complete)

    def test_annulled_candidate_emits_null_answer(self):
        candidate = core.Candidate(
            number=1,
            statement="Enunciado válido.",
            alternatives={letter: f"alternativa {letter}" for letter in "ABCDE"},
            correct="X",
            page=1,
        )
        document = type("Doc", (), {
            "member": "prova-gabarito.pdf",
            "sha256": "1" * 64,
            "size": 100,
            "page_count": 2,
        })()
        record = {
            "questions": {1: candidate},
            "expected": 1,
            "language": None,
            "pairedCount": 0,
            "completeCount": 1,
            "document": document,
            "archive": "source.zip",
            "packageSha256": "0" * 64,
        }
        unit = uneb_v2.build_unit(2025, 2, {"combined": [record], "keys": []})
        self.assertEqual(unit["extractedQuestions"], 1)
        self.assertTrue(unit["structurallyComplete"])
        self.assertIsNone(unit["questions"][0]["correctAlternative"])
        self.assertTrue(unit["questions"][0]["annulled"])


if __name__ == "__main__":
    unittest.main()
