from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "probe-brasil-escola-live-editions.py"
spec = importlib.util.spec_from_file_location("probe_brasil_escola_live_tested", SCRIPT)
assert spec and spec.loader
probe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)


class LiveEditionProbeTests(unittest.TestCase):
    def test_detects_partial_archive_magic(self):
        self.assertEqual(probe.detect_probe_format(b"PK\x03\x04abc"), "zip")
        self.assertEqual(probe.detect_probe_format(b"%PDF-1.7"), "pdf")
        self.assertEqual(probe.detect_probe_format(b"Rar!\x1a\x07\x01"), "rar")

    def test_title_role_hints(self):
        self.assertEqual(probe.role_hint("Provas e gabaritos Fatec 2025/2"), "combined")
        self.assertEqual(probe.role_hint("Prova Unesp 1ª fase 2025"), "exam")
        self.assertEqual(probe.role_hint("Gabarito UEL 2026"), "answer-key")

    def test_usable_edition_requires_both_sides_or_combined(self):
        candidate = {"region": "sudeste", "institution": "X", "institutionSlug": "x", "editionSignals": 3}
        entries = [
            {"downloadId": 1, "title": "Prova X 2024", "year": 2024},
            {"downloadId": 2, "title": "Gabarito X 2024", "year": 2024},
            {"downloadId": 3, "title": "Provas e gabaritos X 2025", "year": 2025},
            {"downloadId": 4, "title": "Gabarito X 2023", "year": 2023},
        ]
        observations = [
            {"availability": "available", "detectedFormat": "pdf"},
            {"availability": "available", "detectedFormat": "pdf"},
            {"availability": "available", "detectedFormat": "zip"},
            {"availability": "available", "detectedFormat": "pdf"},
        ]
        summary = probe.institution_summary(candidate, entries, observations)
        self.assertEqual(summary["liveEditionSignals"], 3)
        self.assertEqual(summary["usableEditionSignals"], 2)
        self.assertEqual(summary["examBearingEditionSignals"], 2)
        self.assertEqual(summary["keyBearingEditionSignals"], 3)

    def test_candidate_selection_respects_exclusions(self):
        ranking = {"ranking": [
            {"institutionSlug": "covered", "editionSignals": 40},
            {"institutionSlug": "next-a", "editionSignals": 30},
            {"institutionSlug": "next-b", "editionSignals": 20},
        ]}
        selected = probe.select_candidates(ranking, top=1, excluded={"covered"})
        self.assertEqual([row["institutionSlug"] for row in selected], ["next-a"])


if __name__ == "__main__":
    unittest.main()
