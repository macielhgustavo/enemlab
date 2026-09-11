from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("harvest_brasil_escola_bulk", SCRIPTS / "harvest-brasil-escola-bulk.py")
assert spec and spec.loader
bulk = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = bulk
spec.loader.exec_module(bulk)


class Entry:
    def __init__(self, institution: str, slug: str) -> None:
        self.institution = institution
        self.institution_slug = slug


class BulkMirrorTests(unittest.TestCase):
    def test_matches_acronym_or_slug(self) -> None:
        entry = Entry("Universidade de Pernambuco - UPE", "universidade-pernambuco-upe")
        self.assertTrue(bulk.matches(entry, ["UPE"]))
        self.assertTrue(bulk.matches(entry, ["pernambuco"]))
        self.assertFalse(bulk.matches(entry, ["UEMA"]))

    def test_default_target_set_has_multiple_institutions(self) -> None:
        self.assertEqual(set(bulk.DEFAULT_INSTITUTIONS), {"UPE", "URCA", "UEMA", "UFPE"})


if __name__ == "__main__":
    unittest.main()
