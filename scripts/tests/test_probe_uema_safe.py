from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "probe-uema-safe.py"
spec = importlib.util.spec_from_file_location("probe_uema_safe_test_target", SCRIPT)
assert spec and spec.loader
probe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)


class ProbeUemaSafeTest(unittest.TestCase):
    def test_classifies_regular_paes(self):
        self.assertEqual(probe.classify_modality("Provas e gabaritos UEMA PAES 2026"), "regular")

    def test_keeps_sixty_plus_separate(self):
        self.assertEqual(probe.classify_modality("Prova e gabarito UEMA 2023 60+"), "sixty-plus")

    def test_keeps_ead_separate(self):
        self.assertEqual(probe.classify_modality("Provas e gabaritos UEMA EaD 2022/2"), "ead")

    def test_detects_historical_phase_without_inventing_one(self):
        self.assertEqual(probe.phase_markers("Provas UEMA PAES 2015 (2ª fase)"), [2])
        self.assertEqual(probe.phase_markers("Provas e gabaritos UEMA PAES 2026"), [])


if __name__ == "__main__":
    unittest.main()
