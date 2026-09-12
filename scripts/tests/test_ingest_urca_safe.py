#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-urca-safe-v2.py"
spec = importlib.util.spec_from_file_location("ingest_urca_safe_v2_test", SCRIPT)
assert spec and spec.loader
urca = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = urca
spec.loader.exec_module(urca)


class UrcaSafeV2Tests(unittest.TestCase):
    def test_question_heading_grammar_is_strict_but_compatible(self):
        accepted = (
            "QUESTÃO 01 Enunciado",
            "QUESTAO 02 Outro enunciado",
            "03. Enunciado legado",
            "04) Enunciado legado",
            "05- Enunciado legado",
        )
        for line in accepted:
            with self.subTest(line=line):
                self.assertIsNotNone(urca.core.Q_RE.match(line))

        rejected = (
            "2020 Vestibular URCA",
            "60 minutos de duração",
            "12 candidatos presentes",
        )
        for line in rejected:
            with self.subTest(line=line):
                self.assertIsNone(urca.core.Q_RE.match(line))

    def test_utf8_safe_replaces_nested_lone_surrogates(self):
        payload = {
            "statement": "antes\ud835\udf00depois",
            "nested": ["ok", "x\ud800y"],
        }
        safe = urca.utf8_safe(payload)
        self.assertNotIn("\ud835", safe["statement"])
        self.assertNotIn("\ud800", safe["nested"][1])
        encoded = json.dumps(safe, ensure_ascii=False).encode("utf-8")
        self.assertTrue(encoded)

    def test_decorate_payload_reports_pairing_gaps_and_visuals(self):
        payload = {
            "units": [
                {"expectedQuestions": 60, "extractedQuestions": 58, "questionsNeedingReview": 3},
                {"expectedQuestions": 60, "extractedQuestions": 60, "questionsNeedingReview": 1},
            ],
            "summary": {"expectedQuestions": 120, "extractedQuestions": 118},
        }
        decorated = urca.decorate_payload(payload)
        self.assertEqual(decorated["units"][0]["missingIdentities"], 2)
        self.assertEqual(decorated["units"][1]["missingIdentities"], 0)
        self.assertEqual(decorated["summary"]["missingIdentities"], 2)
        self.assertEqual(decorated["summary"]["visualDependencies"], 4)


if __name__ == "__main__":
    unittest.main()
