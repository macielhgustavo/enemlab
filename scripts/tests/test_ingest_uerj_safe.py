#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-uerj-safe.py"


def load():
    spec = importlib.util.spec_from_file_location("test_ingest_uerj_module", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class UerjParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_split_question_heading_and_four_alternatives(self):
        pages = ["""QUESTÃO
01
Enunciado seguro.
(A) alfa
(B) beta
(C) gama
(D) delta
"""]
        items = self.mod.parse_question_pages(pages, mode="plain")
        self.assertEqual([item.number for item in items], [1])
        self.assertEqual(items[0].statement, "Enunciado seguro.")
        self.assertEqual(set(items[0].alternatives), {"A", "B", "C", "D"})

    def test_tabular_key_uses_last_language_block_as_english(self):
        text = """1 2 3 4 5
A B C D A
23 24 25 26 27 23 24 25 26 27 23 24 25 26 27
A A A A A B B B B B C C C C C
"""
        parsed = self.mod.parse_key_text(text)
        self.assertEqual(parsed["answers"][1], "A")
        self.assertEqual([parsed["answers"][n] for n in range(23, 28)], ["C"] * 5)

    def test_pair_key_uses_third_language_occurrence(self):
        parsed = self.mod.parse_key_text("12 A 12 B 12 C\n1 D\n")
        self.assertEqual(parsed["answers"][12], "C")
        self.assertEqual(parsed["answers"][1], "D")

    def test_language_lane_requires_english_body(self):
        Candidate = self.mod.core.Candidate
        english = Candidate(12, "According to the text, the following meaning is correct.", {"A": "the first option", "B": "the second option", "C": "another answer", "D": "the final answer"}, 1, "plain")
        french = Candidate(12, "Cette différence est suggérée dans le vers qui suit.", {"A": "une réponse", "B": "le choix", "C": "dans le texte", "D": "la réponse"}, 1, "plain")
        self.assertTrue(self.mod._looks_english(english))
        self.assertFalse(self.mod._looks_english(french))

    def test_language_range_is_declared_by_caderno(self):
        class Doc:
            first_text = "As questões de números 12 a 18 deverão ser respondidas de acordo com sua opção de Língua Estrangeira."
        self.assertEqual(self.mod._language_range(Doc(), []), set(range(12, 19)))
        Doc.first_text = "As questões de números 23 a 27, da área de Linguagens, deverão ser respondidas de acordo com sua opção de Língua Estrangeira."
        self.assertEqual(self.mod._language_range(Doc(), []), set(range(23, 28)))

    def test_mixed_french_prompt_is_not_accepted_from_english_alternatives(self):
        Candidate = self.mod.core.Candidate
        candidate = Candidate(18, "Une réponse possible à la question du poète est proposée.", {"A": "the first option", "B": "the second option", "C": "another answer", "D": "the final answer"}, 1, "plain")
        candidate._uerj_language = "french"
        self.assertFalse(self.mod._looks_english(candidate))

    def test_tabular_key_preserves_annulled_slot(self):
        text = """35 36 37 38 39
A B ANU
LADA C D
"""
        parsed = self.mod.parse_key_text(text)
        self.assertEqual(parsed["answers"][35], "A")
        self.assertEqual(parsed["answers"][36], "B")
        self.assertIsNone(parsed["answers"][37])
        self.assertEqual(parsed["answers"][38], "C")
        self.assertEqual(parsed["answers"][39], "D")

    def test_discursive_and_second_eq_members_are_filtered(self):
        class Doc:
            leaf = "prova.pdf"
            member = "provas-e-gabaritos-exame-discursivo-uerj-2025/prova.pdf"
        self.assertFalse(self.mod.document_allowed("uerj", {}, "UERJ 2025", Doc()))
        Doc.member = "prova-2-exame-qualificacao-uerj-2025.pdf"
        self.assertFalse(self.mod.document_allowed("uerj", {}, "UERJ 2025", Doc()))
        Doc.member = "prova-1-exame-qualificacao-uerj-2025.pdf"
        self.assertTrue(self.mod.document_allowed("uerj", {}, "UERJ 2025", Doc()))

    def test_catalog_year_wins_over_internal_dates(self):
        year, term = self.mod.edition({"title": "Provas e gabaritos UERJ 2025", "year": 2025}, Path("x.zip"), [])
        self.assertEqual((year, term), (2025, None))


if __name__ == "__main__":
    unittest.main()
