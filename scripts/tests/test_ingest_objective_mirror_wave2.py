from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-objective-mirror-wave2.py"
spec = importlib.util.spec_from_file_location("objective_mirror_wave2_tested", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class Wave2ObjectiveMirrorTests(unittest.TestCase):
    def test_unioeste_filters_seriado_and_spanish_but_keeps_regular_booklets(self):
        class RegularEnglish:
            leaf = "prova-unioeste-vestibular-padrao-2026-manha-ingles.pdf"
            first_text = ""
        class RegularAfternoon:
            leaf = "prova-unioeste-vestibular-padrao-2026-tarde.pdf"
            first_text = ""
        class Spanish:
            leaf = "prova-unioeste-vestibular-padrao-2026-manha-espanhol.pdf"
            first_text = ""
        class Seriado:
            leaf = "prova-unioeste-vestibular-2026-seriado1-tarde.pdf"
            first_text = ""
        profile = mod.base.core.PROFILES["unioeste"]
        self.assertTrue(mod.base.core.document_allowed("unioeste", profile, "Unioeste 2026", RegularEnglish()))
        self.assertTrue(mod.base.core.document_allowed("unioeste", profile, "Unioeste 2026", RegularAfternoon()))
        self.assertFalse(mod.base.core.document_allowed("unioeste", profile, "Unioeste 2026", Spanish()))
        self.assertFalse(mod.base.core.document_allowed("unioeste", profile, "Unioeste 2026", Seriado()))

    def test_uel_keeps_canonical_type_one_and_filters_second_phase_variants(self):
        class TypeOne:
            leaf = "prova-dia-1-ingles-uel-2025-tipo-1.pdf"
            first_text = ""
        class TypeTwo:
            leaf = "prova-dia-1-ingles-uel-2025-tipo-2.pdf"
            first_text = ""
        class SecondPhase:
            leaf = "caderno-ingles-uel-2-fase-2023.pdf"
            first_text = ""
        profile = mod.base.core.PROFILES["uel"]
        self.assertTrue(mod.base.core.document_allowed("uel", profile, "Provas e gabaritos UEL 2025", TypeOne()))
        self.assertFalse(mod.base.core.document_allowed("uel", profile, "Provas e gabaritos UEL 2025", TypeTwo()))
        self.assertFalse(mod.base.core.document_allowed("uel", profile, "Provas e gabaritos UEL 2023", SecondPhase()))

    def test_complementary_exam_merge_preserves_all_source_documents(self):
        class Candidate:
            def __init__(self, score):
                self.score = score
        class Doc:
            def __init__(self, name, pages):
                self.member = name
                self.leaf = name
                self.page_count = pages
        first = {"document": Doc("morning.pdf", 10), "questions": {1: Candidate((5, True, 100))}}
        second = {"document": Doc("afternoon.pdf", 25), "questions": {22: Candidate((5, True, 100))}}
        merged = mod.choose_complementary_exam([first, second])
        self.assertEqual(set(merged["questions"]), {1, 22})
        self.assertEqual(len(merged["sourceDocuments"]), 2)


if __name__ == "__main__":
    unittest.main()
