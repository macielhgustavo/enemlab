#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "probe-upe-safe.py"
spec = importlib.util.spec_from_file_location("probe_upe_safe_test", SCRIPT)
assert spec and spec.loader
upe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = upe
spec.loader.exec_module(upe)


class UpeProbeTests(unittest.TestCase):
    def test_variant_keeps_ssa_stages_separate(self):
        self.assertEqual(upe.classify_variant("UPE SSA 2020", "SSA 1 prova.pdf")["stage"], 1)
        self.assertEqual(upe.classify_variant("UPE SSA 2020", "SSA 2 prova.pdf")["stage"], 2)
        self.assertEqual(upe.classify_variant("UPE SSA 2020", "SSA 3 prova.pdf")["stage"], 3)

    def test_ambiguous_package_does_not_force_stage(self):
        result = upe.classify_variant("Provas UPE SSA 1 e 2 2019")
        self.assertEqual(result["modality"], "ssa")
        self.assertIsNone(result["stage"])
        self.assertEqual(result["stageCandidates"], [1, 2])

    def test_ead_is_not_regular(self):
        result = upe.classify_variant("Prova e Gabarito UPE EaD 2017")
        self.assertEqual(result["modality"], "ead")
        self.assertIsNone(result["stage"])

    def test_document_evidence_beats_ambiguous_package_title(self):
        result = upe.classify_variant("SSA 1 e 2 UPE", "Caderno segunda etapa.pdf")
        self.assertEqual(result["stage"], 2)
        self.assertEqual(result["stageEvidence"], "document")


if __name__ == "__main__":
    unittest.main()
