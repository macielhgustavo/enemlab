import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("verify_uft", Path(__file__).resolve().parents[1] / "verify_uft.py")
uft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uft)


class UftParserTests(unittest.TestCase):
    def setUp(self):
        self.title = "VESTIBULAR UFT 2025.1 GABARITO DEFINITIVO PROVA TARDE"
        self.table = []
        for start in range(1, 45, 10):
            numbers = [f"{number:02}" if number <= 44 else None for number in range(start, start + 10)]
            values = ["ANULADA" if number == 28 else "A" if number <= 44 else None for number in range(start, start + 10)]
            self.table.extend([numbers, values])

    def test_complete_deterministic(self):
        result = uft.parse_afternoon(self.title, self.table)
        self.assertEqual(result, uft.parse_afternoon(self.title, copy.deepcopy(self.table)))
        self.assertEqual(len(result[0]), 43)
        self.assertEqual(result[1], [28])
        self.assertNotIn("28", result[0])

    def test_preliminary_and_wrong_edition_rejected(self):
        for title in ["VESTIBULAR UFT 2025.1 GABARITO PROVISÓRIO",
                      self.title.replace("2025.1", "2025.2"),
                      self.title + " PRELIMINAR"]:
            with self.assertRaises(ValueError):
                uft.parse_afternoon(title, self.table)

    def test_missing_duplicate_and_unknown_answer_rejected(self):
        for row, column, value in [(0, 0, None), (0, 1, "01"), (1, 0, "E"), (1, 0, "")]:
            table = copy.deepcopy(self.table)
            table[row][column] = value
            with self.assertRaises(ValueError):
                uft.parse_afternoon(self.title, table)

    def test_retification_changes_result_not_inferred(self):
        self.table[1][0] = "C"
        answers, _annulled = uft.parse_afternoon(self.title, self.table)
        self.assertEqual(answers["1"], "C")

    def test_incompatible_layout_rejected(self):
        with self.assertRaises(ValueError):
            uft.parse_afternoon(self.title, self.table[:-2])
