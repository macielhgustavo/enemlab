from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-cederj-safe.py"
spec = importlib.util.spec_from_file_location("ingest_cederj_safe_tested", SCRIPT)
assert spec and spec.loader
cederj = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = cederj
spec.loader.exec_module(cederj)


class CederjIngestTests(unittest.TestCase):
    def test_key_parser_supports_en_dash_and_english_variant(self):
        text = """
        VESTIBULAR 2025.2
        01 – B 25 – A
        02 – C 26 – D
        LÍNGUA ESPANHOLA
        19 – D 43 – D
        20 – D 44 – C
        21 – C 45 – B
        LÍNGUA INGLESA
        23 – B 43 – C
        24 – B 44 – A
        45 – D
        """
        parsed = cederj.parse_key_text(text)
        self.assertEqual(parsed["expectedMax"], 45)
        self.assertEqual(parsed["answers"][43], "C")
        self.assertEqual(parsed["answers"][44], "A")
        self.assertEqual(parsed["answers"][45], "D")

    def test_key_parser_supports_table_style(self):
        text = """
        Língua Portuguesa Biologia Física
        01 B 09 C 17 B
        02 D 10 B 18 C
        57 A 58 C 59 D 60 C
        """
        parsed = cederj.parse_key_text(text)
        self.assertEqual(parsed["expectedMax"], 60)
        self.assertEqual(parsed["answers"][1], "B")
        self.assertEqual(parsed["answers"][60], "C")

    def test_question_parser_rejects_numbered_instructions_after_body_reset(self):
        pages = ["""
        1. Você recebeu do fiscal um caderno.
        2. Confira a prova.
        QUESTÕES DE MÚLTIPLA ESCOLHA
        LÍNGUA PORTUGUESA
        01 Primeira questão real
        (A) alternativa a
        (B) alternativa b
        (C) alternativa c
        (D) alternativa d
        02 Segunda questão real
        (A) a2
        (B) b2
        (C) c2
        (D) d2
        """]
        parsed = cederj.parse_question_pages(pages)
        self.assertEqual([item.number for item in parsed], [1, 2])
        self.assertTrue(all(item.complete for item in parsed))

    def test_question_parser_prefers_english_duplicate_language_block(self):
        pages = ["""
        QUESTÕES DE MÚLTIPLA ESCOLHA
        01 Comum
        (A) a
        (B) b
        (C) c
        (D) d
        LÍNGUA ESPANHOLA
        43 Espanhol
        (A) ea
        (B) eb
        (C) ec
        (D) ed
        LÍNGUA INGLESA
        43 English
        (A) ia
        (B) ib
        (C) ic
        (D) id
        """]
        chosen = cederj.select_questions(cederj.parse_question_pages(pages))
        self.assertEqual(chosen[43].language, "english")
        self.assertIn("English", chosen[43].statement)

    def test_document_evidence_can_upgrade_plain_catalog_year(self):
        class Document:
            leaf = "prova-cederj-2026.pdf"
            first_text = "VESTIBULAR 2026.1 Caderno de Questões"

        year, term = cederj.effective_edition(
            {"title": "Provas e gabaritos Cederj 2026", "year": 2026},
            Path("dummy.zip"),
            [Document()],
        )
        self.assertEqual((year, term), (2026, 1))


if __name__ == "__main__":
    unittest.main()
