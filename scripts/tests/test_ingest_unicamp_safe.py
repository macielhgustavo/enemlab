from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-unicamp-safe.py"
spec = importlib.util.spec_from_file_location("ingest_unicamp_safe_tested", SCRIPT)
assert spec and spec.loader
unicamp = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = unicamp
spec.loader.exec_module(unicamp)


class UnicampSafeTests(unittest.TestCase):
    def test_canonical_key_stops_before_other_variant(self):
        first = "\n".join(
            f"{n:02d} {'*' if n == 53 else 'A'}"
            for n in range(1, 73)
        )
        second = "\n".join(f"{n:02d} B" for n in range(1, 73))
        payload = unicamp.parse_key_text(first + "\nGABARITO DA PROVA R E W\n" + second)
        self.assertEqual(payload["expectedMax"], 72)
        self.assertEqual(len(payload["answers"]), 72)
        self.assertEqual(payload["answers"][1], "A")
        self.assertIsNone(payload["answers"][53])
        self.assertEqual(payload["answers"][72], "A")

    def test_annual_edition_ignores_second_phase_filename(self):
        document = SimpleNamespace(leaf="2026-2-fase.pdf", first_text="UNICAMP VESTIBULAR 2026 - 2ª FASE")
        year, term = unicamp.edition(
            {"title": "Provas e Gabaritos Unicamp 2026", "year": 2026},
            Path("47778-provas-e-gabaritos-unicamp-2026.zip"),
            [document],
        )
        self.assertEqual((year, term), (2026, 1))

    def test_second_phase_member_is_rejected(self):
        profile = unicamp.core.PROFILES["unicamp"]
        document = SimpleNamespace(
            leaf="prova-exatas-tecnologicas.pdf",
            member="Segunda fase/prova-exatas-tecnologicas.pdf",
            first_text="UNICAMP VESTIBULAR 2022",
        )
        self.assertFalse(
            unicamp.document_allowed(
                "unicamp",
                profile,
                "Provas e gabaritos Unicamp 2022",
                document,
            )
        )

    def test_zero_signal_edition_is_not_emitted(self):
        original = unicamp._original_process
        try:
            unicamp._original_process = lambda profile_name, paths: (
                [
                    {
                        "editionId": "unicamp-2024-1",
                        "year": 2024,
                        "term": 1,
                        "modality": "Vestibular regular",
                        "source": {"title": "Provas e gabaritos Unicamp 2024"},
                        "units": [{"extractedQuestions": 0, "expectedQuestions": 0}],
                        "summary": {
                            "expectedQuestions": 0,
                            "extractedQuestions": 0,
                            "completeUnits": 0,
                            "missingIdentities": 0,
                            "visualDependencies": 0,
                        },
                    },
                    {
                        "editionId": "unicamp-2025-1",
                        "year": 2025,
                        "term": 1,
                        "modality": "Vestibular regular",
                        "source": {"title": "Provas e gabaritos Unicamp 2025"},
                        "units": [{"extractedQuestions": 67, "expectedQuestions": 72}],
                        "summary": {
                            "expectedQuestions": 72,
                            "extractedQuestions": 67,
                            "completeUnits": 0,
                            "missingIdentities": 5,
                            "visualDependencies": 22,
                        },
                    },
                ],
                {
                    "editions": 2,
                    "expectedQuestions": 72,
                    "extractedQuestions": 67,
                    "completeUnits": 0,
                    "missingIdentities": 5,
                    "visualDependencies": 22,
                    "cycles": [],
                    "failures": [],
                },
            )
            editions, summary = unicamp.process("unicamp", [])
        finally:
            unicamp._original_process = original
        self.assertEqual([item["editionId"] for item in editions], ["unicamp-2025-1"])
        self.assertEqual(summary["editions"], 1)
        self.assertEqual(summary["expectedQuestions"], 72)
        self.assertEqual(summary["extractedQuestions"], 67)
        self.assertEqual(summary["discardedEditions"][0]["editionId"], "unicamp-2024-1")


if __name__ == "__main__":
    unittest.main()
