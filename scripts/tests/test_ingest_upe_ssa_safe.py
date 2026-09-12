#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-upe-ssa-safe.py"
spec = importlib.util.spec_from_file_location("ingest_upe_ssa_safe_test", SCRIPT)
assert spec and spec.loader
upe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = upe
spec.loader.exec_module(upe)


class UpeSsaSafeTests(unittest.TestCase):
    def test_member_year_overrides_bad_catalogue_year(self):
        documents = [
            SimpleNamespace(leaf="GABARITO-PRELIMINAR-SSA3-2DIA-2023.pdf", first_text=""),
            SimpleNamespace(leaf="CADERNO-DE-PROVAS-SSA3-1DIA.pdf", first_text=""),
        ]
        year, evidence = upe.derive_package_year({"year": 2022}, documents)
        self.assertEqual(year, 2023)
        self.assertEqual(evidence, "member-name")

    def test_day_prefers_member_name(self):
        self.assertEqual(upe.day(SimpleNamespace(leaf="prova-ssa-2025-upe-1-dia-2-etapa.pdf", first_text="")), 1)
        self.assertEqual(upe.day(SimpleNamespace(leaf="gabarito-preliminar-ssa-3-2026-dia-2.pdf", first_text="")), 2)

    def test_expected_numbers_fill_dense_annulled_gap(self):
        answers = {number: "A" for number in range(1, 51) if number != 23}
        expected = upe.expected_numbers(answers)
        self.assertEqual(expected, list(range(1, 51)))

    def test_answer_value_preserves_explicit_annulment(self):
        self.assertEqual(upe.answer_value("E"), "E")
        self.assertIsNone(upe.answer_value("NULA"))
        self.assertIsNone(upe.answer_value("ANULADA"))
        self.assertIsNone(upe.answer_value("X"))


if __name__ == "__main__":
    unittest.main()
