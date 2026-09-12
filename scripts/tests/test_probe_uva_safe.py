from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "probe-uva-safe.py"
spec = importlib.util.spec_from_file_location("probe_uva_safe_tested", SCRIPT)
assert spec and spec.loader
uva = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = uva
spec.loader.exec_module(uva)


class ProbeUvaSafeTests(unittest.TestCase):
    def test_role_from_filename(self):
        self.assertEqual(uva.classify_role("prova-mat-fis.pdf"), "exam")
        self.assertEqual(uva.classify_role("gabarito-preliminar.pdf"), "answer-key")

    def test_track_classification(self):
        self.assertEqual(uva.classify_track("Prova de Conhecimentos Gerais - Inglês.pdf"), "general-english")
        self.assertEqual(uva.classify_track("prova-espanhol-conhecimentos-gerais.pdf"), "general-spanish")
        self.assertEqual(uva.classify_track("prova-bio-quimica.pdf"), "biology-chemistry")
        self.assertEqual(uva.classify_track("prova-mat-fis.pdf"), "math-physics")
        self.assertEqual(uva.classify_track("Prova de Língua Portuguesa e História.pdf"), "portuguese-history")

    def test_question_patterns(self):
        self.assertEqual(uva.question_match("QUESTÃO 07 Texto"), (7, "Texto"))
        self.assertEqual(uva.question_match("08 - Outro texto"), (8, "Outro texto"))
        self.assertEqual(uva.question_match("09. Mais texto"), (9, "Mais texto"))

    def test_key_pairs_normalize_leading_zeroes(self):
        pairs = [(int(number), token) for number, token in uva.KEY_PAIR.findall("01 A 02 B 03 E")]
        self.assertEqual(pairs, [(1, "A"), (2, "B"), (3, "E")])


if __name__ == "__main__":
    unittest.main()
