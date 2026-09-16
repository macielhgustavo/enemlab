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

    def test_afa_and_epcar_use_exact_fab_provider_identity(self):
        afa = self.target("afa", 2018, "first")
        epcar = self.target("epcar", 2018, "first")
        self.assertEqual(afa.option_ids, ("A", "B", "C", "D"))
        self.assertEqual(epcar.option_ids, ("A", "B", "C", "D"))
        self.assertEqual(native_ingest.question_key_for(afa, 1), "afa-2018-first-1")
        self.assertEqual(native_ingest.question_key_for(afa, afa.total), f"afa-2018-first-{afa.total}")
        self.assertEqual(native_ingest.question_key_for(epcar, 1), "epcar-2018-first-1")
        self.assertEqual(
            native_ingest.question_key_for(epcar, epcar.total),
            f"epcar-2018-first-{epcar.total}",
        )

    def test_ime_uses_objective_segment_from_real_provider_identity(self):
        ime = self.target("ime", 2026, "first")
        self.assertEqual(ime.edition_id, "2025-2026")
        self.assertEqual(ime.option_ids, ("A", "B", "C", "D", "E"))
        self.assertEqual(native_ingest.question_key_for(ime, 1), "ime-2025-2026-objective-1")
        self.assertEqual(
            native_ingest.question_key_for(ime, ime.total),
            f"ime-2025-2026-objective-{ime.total}",
        )

    def test_audited_identity_does_not_bypass_source_gate(self):
        afa = self.target("afa", 2018, "first")
        self.assertIsNone(afa.exam_url)
        self.assertEqual(afa.status, "blocked")
        self.assertIn("URL", afa.reason or "")
        # Identidade e fonte são gates independentes: a chave pode estar
        # comprovada mesmo quando o caderno ainda não está disponível.
        self.assertEqual(native_ingest.question_key_for(afa, 1), "afa-2018-first-1")

    def test_esa_html_source_is_not_misrepresented_as_pdf(self):
        esa = self.target("esa", 2022, "single")
        self.assertEqual(esa.status, "blocked")
        self.assertIn("HTML", esa.reason or "")
        # Mesmo com um PDF local, ainda não se pode criar pack enquanto a
        # identidade custom não estiver alinhada ao caminho usado no app.
        with self.assertRaises(native_ingest.core.NativeOrchestratorError):
            native_ingest.question_key_for(esa, 1)

    def test_eear_inventory_keeps_the_existing_curated_filter(self):
        eear = [target for target in self.targets if target.provider_id == "eear"]
        self.assertGreater(len(eear), 0, "EEAR não pode desaparecer silenciosamente do inventário")
        labels = " ".join(
            f"{target.label} {target.edition_id or ''}".lower()
            for target in eear
        )
        for term in native_ingest.core.SENSITIVE_EEAR_TERMS:
            self.assertNotIn(term, labels)
        for target in eear:
            self.assertEqual(target.option_ids, ("A", "B", "C", "D"))
            self.assertTrue(target.exam_url)

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

        afa = next(item for item in payload["items"] if item["identity"] == "afa:2018:first")
        self.assertTrue(afa["identityValid"])
        self.assertEqual(afa["questionKeyFormat"], "afa-2018-first-{number}")
        self.assertEqual(afa["status"], "blocked")

        ime = next(item for item in payload["items"] if item["identity"] == "ime:2025-2026:first")
        self.assertTrue(ime["identityValid"])
        self.assertEqual(ime["questionKeyFormat"], "ime-2025-2026-objective-{number}")


if __name__ == "__main__":
    unittest.main()
