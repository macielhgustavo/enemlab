from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-unioeste-safe.py"
spec = importlib.util.spec_from_file_location("unioeste_safe_tested", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

class Doc:
    def __init__(self, member: str, pages: int = 10):
        self.member = member
        self.leaf = Path(member).name
        self.first_text = ""
        self.page_count = pages

class Candidate:
    def __init__(self, score):
        self.score = score

class UnioesteObjectiveTests(unittest.TestCase):
    def setUp(self):
        self.profile = mod.core.PROFILES["unioeste"]

    def allowed(self, member: str) -> bool:
        return mod.document_allowed("unioeste", self.profile, "Unioeste 2026", Doc(member))

    def test_keeps_regular_english_morning_and_afternoon(self):
        self.assertTrue(self.allowed("regular/prova-unioeste-2026-manha-ingles.pdf"))
        self.assertTrue(self.allowed("regular/prova-unioeste-2026-tarde.pdf"))

    def test_rejects_spanish_and_seriado_even_in_parent_directory(self):
        self.assertFalse(self.allowed("espanhol/prova-unioeste-2026-manha.pdf"))
        self.assertFalse(self.allowed("seriado/prova-unioeste-2026-tarde.pdf"))

    def test_complementary_merge_keeps_non_overlapping_questions(self):
        first = {"document": Doc("morning.pdf", 12), "questions": {1: Candidate((5, True, 100))}}
        second = {"document": Doc("afternoon.pdf", 24), "questions": {22: Candidate((5, True, 100))}}
        merged = mod.choose_complementary_exam([first, second])
        self.assertEqual(set(merged["questions"]), {1, 22})
        self.assertEqual(len(merged["sourceDocuments"]), 2)

    def test_collision_retains_strongest_parse(self):
        first = {"document": Doc("morning.pdf"), "questions": {5: Candidate((4, False, 50))}}
        second = {"document": Doc("afternoon.pdf"), "questions": {5: Candidate((5, True, 90))}}
        merged = mod.choose_complementary_exam([first, second])
        self.assertEqual(merged["questions"][5].score, (5, True, 90))

if __name__ == "__main__":
    unittest.main()
