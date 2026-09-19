from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-unimontes-safe.py"
spec = importlib.util.spec_from_file_location("unimontes_safe_tested", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

class Doc:
    def __init__(self, member: str, text: str = ""):
        self.member = member
        self.leaf = Path(member).name
        self.first_text = text

class UnimontesObjectiveTests(unittest.TestCase):
    def setUp(self):
        self.profile = mod.core.PROFILES["unimontes"]

    def allowed(self, title: str, member: str, text: str = "") -> bool:
        return mod.document_allowed("unimontes", self.profile, title, Doc(member, text))

    def test_keeps_only_canonical_group_one_biological_exam_and_key(self):
        self.assertTrue(self.allowed(
            "Provas e gabaritos Unimontes 2026",
            "prova-unimontes-2026-biologicas-grupo-1.pdf",
            "QUESTÃO 01",
        ))
        self.assertFalse(self.allowed(
            "Provas e gabaritos Unimontes 2026",
            "prova-unimontes-2026-humanas-grupo-1.pdf",
            "QUESTÃO 01",
        ))
        self.assertFalse(self.allowed(
            "Provas e gabaritos Unimontes 2026",
            "prova-unimontes-2026-biologicas-grupo-2.pdf",
            "QUESTÃO 01",
        ))
        self.assertTrue(self.allowed(
            "Provas e gabaritos Unimontes 2026",
            "gabaritos-unimontes-2026-grupo-1.pdf",
            "GABARITO DAS PROVAS",
        ))

    def test_rejects_paes(self):
        self.assertFalse(self.allowed(
            "Provas e gabaritos Unimontes PAES 2020",
            "prova-grupo-1-biologicas.pdf",
            "QUESTÃO 01",
        ))

    def test_parses_2024_dense_caderno_101(self):
        pairs = " ".join(f"{n} {'ABCD'[(n-1)%4]}" for n in range(1, 46))
        text = f"CADERNO 101 - BIOLÓGICAS\n{pairs}\nCADERNO 201 - HUMANAS\n1 D"
        result = mod.parse_key_text(text)
        self.assertEqual(result["expectedMax"], 45)
        self.assertEqual(result["contiguous"], 45)
        self.assertEqual(len(result["answers"]), 45)

    def test_parses_tabular_key_and_prefers_english_duplicate(self):
        rows = []
        rows.append("CADERNO 101 ÁREA 3 BIOLÓGICAS")
        rows.append("Nº QUESTÕES 01 02 03 04 05 06 07 08 09 10  Nº QUESTÕES 11 12 13 14 15")
        rows.append("RESPOSTAS A B C D A B C D A B  RESPOSTAS C D A B C")
        rows.append("LÍNGUA ESTRANGEIRA (ESPANHOL)   LÍNGUA ESTRANGEIRA (INGLÊS)")
        rows.append("Nº QUESTÕES 16 17 18 19  Nº QUESTÕES 16 17 18 19")
        rows.append("RESPOSTAS A A A A  RESPOSTAS B C D A")
        rows.append("Nº QUESTÕES 20 21 22  Nº QUESTÕES 23 24 25")
        rows.append("RESPOSTAS B C D  RESPOSTAS A B C")
        rows.append("Nº QUESTÕES 26 27 28 29 30 31 32 33 34 35")
        rows.append("RESPOSTAS A B C D A B C D A B")
        rows.append("Nº QUESTÕES 36 37 38 39 40 41 42 43 44 45")
        rows.append("RESPOSTAS C D A B C D A B C D")
        rows.append("CADERNO 102 ÁREA 1 HUMANAS")
        result = mod.parse_key_text("\n".join(rows))
        self.assertEqual(result["contiguous"], 45)
        self.assertEqual(result["answers"][16], "B")
        self.assertEqual(result["answers"][17], "C")
        self.assertEqual(result["answers"][18], "D")
        self.assertEqual(result["answers"][19], "A")

    def test_question_parser_prefers_english_duplicate_language_block(self):
        text = """
LÍNGUA ESTRANGEIRA (ESPANHOL)
QUESTÃO 16
Enunciado espanhol
A) a
B) b
C) c
D) d
LÍNGUA ESTRANGEIRA (INGLÊS)
QUESTÃO 16
English statement
A) aa
B) bb
C) cc
D) dd
"""
        candidates = mod.parse_question_pages([text], mode="plain")
        chosen = max((c for c in candidates if c.number == 16), key=mod.candidate_rank)
        self.assertEqual(getattr(chosen, "_unimontes_language"), "english")
        self.assertIn("English statement", chosen.statement)

if __name__ == "__main__":
    unittest.main()
