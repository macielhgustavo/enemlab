from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "probe-cederj-safe.py"
spec = importlib.util.spec_from_file_location("probe_cederj_safe_tested", SCRIPT)
assert spec and spec.loader
probe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)


class CederjProbeTests(unittest.TestCase):
    def test_edition_key_preserves_semester(self):
        self.assertEqual(probe.edition_key("Provas e gabaritos Cederj 2025/2", 2025), "2025-2")
        self.assertEqual(probe.edition_key("Provas e gabaritos Cederj 2024-1", 2024), "2024-1")

    def test_edition_key_plain_year(self):
        self.assertEqual(probe.edition_key("Provas e gabaritos Cederj 2026", 2026), "2026")

    def test_justification_is_not_exam(self):
        self.assertEqual(
            probe.classify_role("VestibularCederj2024-1_JustificativadeRespostas.pdf"),
            "rationale",
        )

    def test_filename_roles(self):
        self.assertEqual(probe.classify_role("gabarito-cederj-2025-1.pdf"), "answer-key")
        self.assertEqual(probe.classify_role("prova-cederj-2025-1.pdf"), "exam")


if __name__ == "__main__":
    unittest.main()
