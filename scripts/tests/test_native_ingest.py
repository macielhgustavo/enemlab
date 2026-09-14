from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

SPEC = importlib.util.spec_from_file_location("native_ingest", SCRIPTS / "native_ingest.py")
assert SPEC and SPEC.loader
native_ingest = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = native_ingest
SPEC.loader.exec_module(native_ingest)


class NativeInventoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.targets = native_ingest.discover_targets()

    def target(self, provider: str, year: int, phase: str):
        return next(
            target
            for target in self.targets
            if target.provider_id == provider and target.year == year and target.phase == phase
        )

    def test_no_duplicate_executable_identity(self):
        identities = [target.identity for target in self.targets]
        self.assertEqual(len(identities), len(set(identities)))

    def test_unesp_2026_is_ready_for_native_pipeline(self):
        target = self.target("unesp", 2026, "first")
        self.assertEqual(target.status, "ready")
        self.assertEqual(target.total, 90)
        self.assertEqual(target.option_ids, ("A", "B", "C", "D", "E"))
        self.assertTrue(target.exam_url)

    def test_fatec_2026_is_discovered_from_generated_typescript(self):
        target = next(
            target
            for target in self.targets
            if target.provider_id == "fatec" and target.edition_id == "2026.1"
        )
        self.assertEqual(target.status, "ready")
        self.assertEqual(target.total, 60)

    def test_unioeste_sessions_use_the_real_sequence_lengths(self):
        morning = self.target("unioeste", 2026, "morning")
        afternoon = self.target("unioeste", 2026, "afternoon")
        self.assertEqual(morning.status, "ready")
        self.assertEqual(afternoon.status, "ready")
        self.assertEqual(morning.total, 27)
        self.assertEqual(afternoon.total, 72)

    def test_custom_identity_provider_is_blocked_instead_of_guessing(self):
        ime = self.target("ime", 2026, "first")
        self.assertEqual(ime.status, "blocked")
        self.assertIn("questionKey", ime.reason or "")

    def test_esa_html_source_is_not_misrepresented_as_pdf(self):
        esa = self.target("esa", 2022, "single")
        self.assertEqual(esa.status, "blocked")
        self.assertIn("HTML", esa.reason or "")

    def test_eear_inventory_never_reintroduces_sensitive_specialties(self):
        labels = " ".join(
            f"{target.label} {target.edition_id or ''}".lower()
            for target in self.targets
            if target.provider_id == "eear"
        )
        for term in native_ingest.core.SENSITIVE_EEAR_TERMS:
            self.assertNotIn(term, labels)

    def test_ready_inventory_is_single_answer_only(self):
        for target in self.targets:
            if target.status != "ready":
                continue
            self.assertGreaterEqual(len(target.option_ids), 2)
            self.assertEqual(len(target.option_ids), len(set(target.option_ids)))
            self.assertTrue(set(target.option_ids).issubset(set("ABCDE")))


if __name__ == "__main__":
    unittest.main()
