from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-objective-mirror-safe.py"
spec = importlib.util.spec_from_file_location("objective_mirror_tested", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class ObjectiveMirrorTests(unittest.TestCase):
    def test_question_parser_handles_fatec_style_five_alternatives(self):
        pages = ["""
        1. instrução sem alternativas
        QUESTÃO 01 Texto real da questão
        (A) opção a
        (B) opção b
        (C) opção c
        (D) opção d
        (E) opção e
        02. Outra questão
        A) a2
        B) b2
        C) c2
        D) d2
        E) e2
        """]
        parsed = mod.parse_question_pages(pages, mode="plain")
        self.assertEqual([item.number for item in parsed], [1, 2])
        self.assertTrue(all(len(item.alternatives) == 5 for item in parsed))

    def test_key_parser_handles_en_dash_and_table_rows(self):
        parsed = mod.parse_key_text("01 – C 28 – B\n02 – E 29 – A\n03 – D 30 – X")
        self.assertEqual(parsed["answers"][1], "C")
        self.assertEqual(parsed["answers"][29], "A")
        self.assertIsNone(parsed["answers"][30])
        self.assertEqual(parsed["expectedMax"], 30)

    def test_ufu_filter_uses_identity_not_exam_body_subject_words(self):
        class Doc:
            leaf = "prova-vestibular-ufu-2025-2.pdf"
            first_text = "Biologia Física História Matemática primeira fase"
        profile = mod.PROFILES["ufu"]
        self.assertTrue(mod.document_allowed("ufu", profile, "Provas e gabaritos UFU 2025/2", Doc()))

    def test_ufu_second_phase_and_french_are_filtered(self):
        class Second:
            leaf = "prova-ufu-2025-2-segunda-fase.pdf"
            first_text = ""
        class French:
            leaf = "prova-vestibular-ufu-2024-2-frances-1-fase.pdf"
            first_text = ""
        profile = mod.PROFILES["ufu"]
        self.assertFalse(mod.document_allowed("ufu", profile, "UFU 2025/2", Second()))
        self.assertFalse(mod.document_allowed("ufu", profile, "UFU 2024/2", French()))

    def test_fatec_non_exam_documents_are_filtered(self):
        class Doc:
            leaf = "sisu-2024-termo-de-adesao-ufc.pdf"
            first_text = ""
        profile = mod.PROFILES["fatec"]
        self.assertFalse(mod.document_allowed("fatec", profile, "Fatec 2024/1", Doc()))

    def test_ueg_medicine_is_separate_modality_and_reapplication_filtered(self):
        self.assertEqual(mod.modality("ueg", "Prova UEG Medicina 2025/2"), "Vestibular Medicina")
        class Doc:
            leaf = "prova-ueg-medicina-2025-2-reaplicacao.pdf"
            first_text = ""
        profile = mod.PROFILES["ueg"]
        self.assertFalse(mod.document_allowed("ueg", profile, "UEG Medicina 2025/2", Doc()))

    def test_document_evidence_overrides_mirror_cycle(self):
        class Doc:
            leaf = "ufu-2025-2-prova-1.pdf"
            first_text = "Vestibular UFU 2025/2"
        self.assertEqual(mod.edition({"title": "Provas e gabaritos UFU 2026-2"}, Path("dummy.zip"), [Doc()]), (2025, 2))


if __name__ == "__main__":
    unittest.main()
