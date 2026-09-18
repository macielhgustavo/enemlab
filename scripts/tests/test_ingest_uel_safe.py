#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-uel-safe.py"

spec = importlib.util.spec_from_file_location("uel_safe_test_target", SCRIPT)
assert spec and spec.loader
uel = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = uel
spec.loader.exec_module(uel)

class Doc:
    def __init__(self, member: str):
        self.member = member
        self.leaf = Path(member).name
        self.first_text = ""

class UELProfileTests(unittest.TestCase):
    def setUp(self):
        self.profile = uel.core.PROFILES["uel"]

    def allowed(self, member: str) -> bool:
        return uel.document_allowed("uel", self.profile, "Provas e gabaritos UEL 2026", Doc(member))

    def test_accepts_canonical_type_1_english(self):
        self.assertTrue(self.allowed("prova-tipo-1-ingles-uel-2026-dia-1.PDF"))
        self.assertTrue(self.allowed("gabarito-definitivo-tipo-1-ingles-uel-2026-dia-1.PDF"))

    def test_rejects_noncanonical_type(self):
        self.assertFalse(self.allowed("prova-tipo-2-ingles-uel-2026-dia-1.PDF"))
        self.assertFalse(self.allowed("gabarito-tipo-3-ingles-uel-2026-dia-1.PDF"))

    def test_rejects_spanish_lane(self):
        self.assertFalse(self.allowed("gabarito-definitivo-dia-1-espanhol-uel-2025.PDF"))

    def test_accepts_untyped_regular_documents(self):
        self.assertTrue(self.allowed("prova-01-uel-2023.PDF"))
        self.assertTrue(self.allowed("gabarito-01-uel-2023.PDF"))

if __name__ == "__main__":
    unittest.main()
