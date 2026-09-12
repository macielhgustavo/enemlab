from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-uema-paes-safe.py"
spec = importlib.util.spec_from_file_location("ingest_uema_paes_safe_test_target", SCRIPT)
assert spec and spec.loader
uema = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = uema
spec.loader.exec_module(uema)


class DummyDocument:
    def __init__(self, leaf: str):
        self.leaf = leaf


class IngestUemaPaesSafeTest(unittest.TestCase):
    def test_conflicting_language_answers_are_not_silently_selected(self):
        answers, conflicts = uema.parse_key_text("16 B\n17 D\n16 A\n17 D\n18 NULA")
        self.assertNotIn(16, answers)
        self.assertIn(16, conflicts)
        self.assertEqual(answers[17], "D")
        self.assertIsNone(answers[18])

    def test_2021_day_is_derived_from_member_identity(self):
        self.assertEqual(uema.document_day(DummyDocument("1-PROVA-PAES-2021-DIA-04_07_2021.pdf"), 2021), 1)
        self.assertEqual(uema.document_day(DummyDocument("2-GAB_DEFINITIVO-PAES-2021-PROVA-DIA-05_07_2021.pdf"), 2021), 2)

    def test_modern_single_day_paes_defaults_to_one_unit(self):
        self.assertEqual(uema.document_day(DummyDocument("prova-uema-paes-2026.pdf"), 2026), 1)

    def test_package_year_uses_catalogue_edition_not_exam_date(self):
        self.assertEqual(uema.package_year({"year": 2026}, Path("provas-uema-paes-2026.zip")), 2026)


if __name__ == "__main__":
    unittest.main()
