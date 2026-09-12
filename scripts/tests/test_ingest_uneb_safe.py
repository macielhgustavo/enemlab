from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-uneb-safe.py"
spec = importlib.util.spec_from_file_location("ingest_uneb_safe_tested", SCRIPT)
assert spec and spec.loader
uneb = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = uneb
spec.loader.exec_module(uneb)


class IngestUnebSafeTests(unittest.TestCase):
    def test_document_day_and_language_from_member_name(self):
        english = SimpleNamespace(leaf="prova-gabarito-uneb-2025-dia-1-ingles.pdf", first_text="")
        second = SimpleNamespace(leaf="prova-gabarito-uneb-2025-dia-2.pdf", first_text="")
        self.assertEqual(uneb.document_day(english), 1)
        self.assertEqual(uneb.document_language(english), "english")
        self.assertEqual(uneb.document_day(second), 2)
        self.assertIsNone(uneb.document_language(second))

    def test_parse_inline_corrected_questions(self):
        pages = ["""
Este caderno é composto por 02 (duas) questões objetivas.
Questão 01
(Correta: B)
Enunciado da primeira questão.
(A) alternativa a
(B) alternativa b
(C) alternativa c
(D) alternativa d
(E) alternativa e
Questão 02
(Correta: E)
Enunciado da segunda questão.
(A) opção a
(B) opção b
(C) opção c
(D) opção d
(E) opção e
"""]
        questions, expected = uneb.parse_inline_text(pages)
        self.assertEqual(expected, 2)
        self.assertEqual(set(questions), {1, 2})
        self.assertTrue(questions[1].complete)
        self.assertEqual(questions[1].correct, "B")
        self.assertEqual(questions[2].correct, "E")

    def test_choose_one_canonical_language_variant(self):
        base_record = {
            "pairedCount": 45,
            "completeCount": 45,
            "expected": 45,
            "document": SimpleNamespace(page_count=20),
        }
        english = {**base_record, "language": "english"}
        spanish = {**base_record, "language": "spanish"}
        french = {**base_record, "language": "french"}
        self.assertIs(uneb.choose_combined([spanish, french, english]), english)

    def test_expected_from_dense_key_identities(self):
        document = SimpleNamespace(
            member="gabarito.pdf",
            sha256="1" * 64,
            size=123,
            page_count=2,
        )
        bucket = {
            "combined": [],
            "keys": [{
                "identities": set(range(1, 46)),
                "status": "definitive",
                "document": document,
                "archive": "key.zip",
                "packageSha256": "0" * 64,
                "downloadId": 1,
                "title": "Gabarito UNEB",
            }],
        }
        unit = uneb.build_unit(2022, 1, bucket)
        self.assertEqual(unit["expectedQuestions"], 45)
        self.assertEqual(unit["extractedQuestions"], 0)
        self.assertEqual(unit["missingIdentities"], 45)
        self.assertIn("answer-key-only:definitive", unit["issues"])


if __name__ == "__main__":
    unittest.main()
