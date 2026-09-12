from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "probe-uneb-safe.py"
spec = importlib.util.spec_from_file_location("probe_uneb_safe_tested", SCRIPT)
assert spec and spec.loader
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ProbeUnebSafeTests(unittest.TestCase):
    def test_combined_role_from_filename(self):
        self.assertEqual(probe.classify_role("prova-gabarito-uneb-2024-dia-1-ingles.pdf"), "combined")
        self.assertEqual(probe.classify_role("Gabarito-UNEB-primeiro-dia-Pos-recursos.pdf"), "answer-key")

    def test_day_classification_variants(self):
        self.assertEqual(probe.classify_day("prova-gabarito-uneb-2024-dia-1-ingles.pdf"), 1)
        self.assertEqual(probe.classify_day("gabarito-preliminar-uneb-2023-segundo-dia.pdf"), 2)

    def test_language_classification(self):
        self.assertEqual(probe.classify_language("prova-gabarito-uneb-2024-dia-1-ingles.pdf"), "english")
        self.assertEqual(probe.classify_language("prova-gabarito-uneb-2024-dia-1-espanhol.pdf"), "spanish")
        self.assertEqual(probe.classify_language("prova-gabarito-uneb-2024-dia-1-frances.pdf"), "french")
        self.assertIsNone(probe.classify_language("prova-gabarito-uneb-2024-dia-2.pdf"))

    def test_question_and_key_patterns(self):
        question = probe.QUESTION_LINE.match("QUESTÃO 07 Texto da questão")
        self.assertIsNotNone(question)
        self.assertEqual(int(question.group(1)), 7)
        pairs = [(int(number), token) for number, token in probe.KEY_PAIR.findall("01 A 02 B 03 C")]
        self.assertEqual(pairs, [(1, "A"), (2, "B"), (3, "C")])


if __name__ == "__main__":
    unittest.main()
