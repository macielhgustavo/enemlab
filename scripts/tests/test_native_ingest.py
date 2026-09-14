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
        self.assertEqual(native_ingest.question_key_for(target, 1), "unesp-2026-first-1")
        self.assertEqual(native_ingest.question_key_for(target, 90), "unesp-2026-first-90")

    def test_fatec_2026_is_discovered_with_normalized_provider_identity(self):
        target = next(
            target
            for target in self.targets
            if target.provider_id == "fatec" and target.edition_id == "2026.1"
        )
        self.assertEqual(target.status, "ready")
        self.assertEqual(target.total, 60)
        # buildQuestionKey normaliza o ponto da edição para hífen.
        self.assertEqual(native_ingest.question_key_for(target, 1), "fatec-2026-1-single-1")

    def test_unioeste_sessions_use_real_lengths_and_exact_app_identity(self):
        morning = self.target("unioeste", 2026, "morning")
        afternoon = self.target("unioeste", 2026, "afternoon")
        self.assertEqual(morning.status, "ready")
        self.assertEqual(afternoon.status, "ready")
        self.assertEqual(morning.total, 27)
        self.assertEqual(afternoon.total, 72)
        self.assertEqual(
            native_ingest.question_key_for(morning, 1),
            "unioeste-2026-morning-ingles-1",
        )
        self.assertEqual(
            native_ingest.question_key_for(afternoon, 1),
            "unioeste-2026-afternoon-1",
        )

    def test_custom_identity_provider_is_blocked_instead_of_guessing(self):
        ime = self.target("ime", 2026, "first")
        self.assertEqual(ime.status, "blocked")
        self.assertIn("questionKey", ime.reason or "")
        with self.assertRaises(native_ingest.core.NativeOrchestratorError):
            native_ingest.question_key_for(ime, 1)

    def test_esa_html_source_is_not_misrepresented_as_pdf(self):
        esa = self.target("esa", 2022, "single")
        self.assertEqual(esa.status, "blocked")
        self.assertIn("HTML", esa.reason or "")
        # Mesmo com um PDF local, ainda não se pode criar pack enquanto a
        # identidade custom não estiver alinhada ao caminho usado no app.
        with self.assertRaises(native_ingest.core.NativeOrchestratorError):
            native_ingest.question_key_for(esa, 1)

    def test_eear_inventory_keeps_the_existing_curated_filter(self):
        labels = " ".join(
            f"{target.label} {target.edition_id or ''}".lower()
            for target in self.targets
            if target.provider_id == "eear"
        )
        for term in native_ingest.core.SENSITIVE_EEAR_TERMS:
            self.assertNotIn(term, labels)

    def test_ready_inventory_is_single_answer_only_and_identity_audited(self):
        for target in self.targets:
            if target.status != "ready":
                continue
            self.assertGreaterEqual(len(target.option_ids), 2)
            self.assertEqual(len(target.option_ids), len(set(target.option_ids)))
            self.assertTrue(set(target.option_ids).issubset(set("ABCDE")))
            keys = [native_ingest.question_key_for(target, n) for n in range(1, target.total + 1)]
            self.assertEqual(len(keys), len(set(keys)))

    def test_inventory_reports_identity_gate_separately_from_source_gate(self):
        payload = native_ingest._payload(self.targets)
        self.assertEqual(payload["schemaVersion"], 2)
        unesp = next(item for item in payload["items"] if item["identity"] == "unesp:2026:first")
        self.assertTrue(unesp["identityValid"])
        self.assertEqual(unesp["questionKeyFormat"], "unesp-2026-first-{number}")


if __name__ == "__main__":
    unittest.main()
