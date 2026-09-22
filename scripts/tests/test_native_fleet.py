import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS = Path(__file__).parents[1]
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("native_fleet", SCRIPTS / "native_fleet.py")
fleet = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = fleet
assert SPEC.loader is not None
SPEC.loader.exec_module(fleet)


class Target:
    provider_id = "unesp"
    year = 2026
    edition_id = None
    phase = "first"
    total = 1


class NativeFleetTests(unittest.TestCase):
    def test_rect_fingerprint_matches_typescript_base36_contract(self):
        rect = {"x": 0.05, "y": 0.1, "width": 0.4, "height": 0.25}
        self.assertEqual(fleet._rect_fingerprint(rect), "12kw-255s-8kn4-5cwg")
        self.assertEqual(
            fleet._region_path("native/unesp/2026/first/abc", 3, rect),
            "native/unesp/2026/first/abc/regions/page-003-12kw-255s-8kn4-5cwg.webp",
        )

    def test_gate_accepts_visual_canonical_semantic_exception_only(self):
        target = Target()
        fleet.ingest.question_key_for = lambda _target, number: f"unesp-2026-first-{number}"
        pack = {
            "documents": [{"pageCount": 2}],
            "questions": [{
                "questionKey": "unesp-2026-first-1",
                "number": 1,
                "visualRegions": [{
                    "page": 1,
                    "rect": {"x": 0.05, "y": 0.1, "width": 0.4, "height": 0.25},
                }],
                "extraction": {
                    "markerDetected": True,
                    "visualCompleteness": {"resolved": True},
                    "issues": [
                        "alternativas semânticas não foram reconhecidas integralmente; usar visual canônico e revisar texto"
                    ],
                },
            }],
        }
        self.assertEqual(fleet._automation_gate(target, pack), [])

    def test_gate_fails_closed_on_unresolved_visual_dependency(self):
        target = Target()
        fleet.ingest.question_key_for = lambda _target, number: f"unesp-2026-first-{number}"
        pack = {
            "documents": [{"pageCount": 2}],
            "questions": [{
                "questionKey": "unesp-2026-first-1",
                "number": 1,
                "visualRegions": [{
                    "page": 1,
                    "rect": {"x": 0.05, "y": 0.1, "width": 0.4, "height": 0.25},
                }],
                "extraction": {
                    "markerDetected": True,
                    "visualCompleteness": {"resolved": False},
                    "issues": [],
                },
            }],
        }
        self.assertIn("Q1: completude visual não resolvida", fleet._automation_gate(target, pack))

    def test_publish_refreshes_signed_url_after_failed_round(self):
        with tempfile.TemporaryDirectory() as temp:
            bundle_dir = Path(temp)
            asset_file = bundle_dir / "asset.webp"
            asset_file.write_bytes(b"webp")
            (bundle_dir / "native-pack.json").write_text("{}", encoding="utf-8")
            (bundle_dir / "bundle.json").write_text(
                json.dumps({
                    "revision": "native-fleet@1",
                    "packFile": "native-pack.json",
                    "assets": [{
                        "path": "native/test/asset.webp",
                        "localPath": "asset.webp",
                        "bytes": 4,
                    }],
                }),
                encoding="utf-8",
            )

            broker_actions = []

            def fake_broker(payload, _publisher_url):
                broker_actions.append(payload["action"])
                if payload["action"] == "begin":
                    occurrence = broker_actions.count("begin")
                    return {
                        "skip": False,
                        "uploads": [{
                            "path": "native/test/asset.webp",
                            "signedUrl": f"https://signed/{occurrence}",
                        }],
                    }
                return {"published": True, "packId": "test", "assets": 1}

            uploaded_urls = []

            def fake_upload(url, _path):
                uploaded_urls.append(url)
                if url.endswith("/1"):
                    raise fleet.NativeFleetError("signed upload asset.webp: HTTP 403")

            with patch.object(fleet, "_broker", side_effect=fake_broker), patch.object(
                fleet, "_upload_signed", side_effect=fake_upload
            ):
                result = fleet._publish_bundle(bundle_dir, "https://publisher.invalid")

            self.assertTrue(result["published"])
            self.assertEqual(broker_actions, ["begin", "begin", "finalize"])
            self.assertEqual(uploaded_urls, ["https://signed/1", "https://signed/2"])

    def test_health_classifies_source_and_marker_failures(self):
        source = fleet._target_health(
            "espcex:2025:day1",
            1,
            "urllib.error.URLError: <urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed>",
        )
        missing = fleet._target_health(
            "unioeste:2026:morning",
            1,
            "NativeFleetError: marcadores faltantes: [1, 2, 3]",
        )
        duplicate = fleet._target_health(
            "fatec:2024.1:single",
            1,
            "NativePipelineError: marcadores duplicados: [14]",
        )

        self.assertEqual(source["status"], "degraded")
        self.assertEqual(source["category"], "source")
        self.assertEqual(missing["category"], "missing-markers")
        self.assertEqual(duplicate["category"], "duplicate-markers")

    def test_health_success_is_healthy(self):
        health = fleet._target_health("unesp:2026:first", 0, "")
        self.assertEqual(
            health,
            {
                "schemaVersion": 1,
                "identity": "unesp:2026:first",
                "status": "healthy",
                "category": None,
                "reason": None,
            },
        )

    def test_health_summary_keeps_degraded_targets_local(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            healthy_dir = root / "healthy"
            degraded_dir = root / "degraded"
            healthy_dir.mkdir()
            degraded_dir.mkdir()
            fleet._write_health(
                fleet._target_health("unesp:2026:first", 0, ""),
                healthy_dir / "health.json",
            )
            fleet._write_health(
                fleet._target_health(
                    "fatec:2024.1:single",
                    1,
                    "NativePipelineError: marcadores duplicados: [14]",
                ),
                degraded_dir / "health.json",
            )

            summary = fleet._health_summary(fleet._collect_health(root))
            markdown = fleet._health_markdown(summary)

        self.assertEqual(summary["targets"], 2)
        self.assertEqual(summary["counts"]["healthy"], 1)
        self.assertEqual(summary["counts"]["degraded"], 1)
        self.assertEqual(summary["categories"], {"duplicate-markers": 1})
        self.assertIn("fatec:2024.1:single", markdown)

    def test_plan_can_select_one_exact_target(self):
        wanted = SimpleNamespace(
            status="ready",
            provider_id="eear",
            identity="eear:2018-eags-eletronica:single",
            edition_id="2018-eags-eletronica",
            year=2018,
            phase="single",
            total=100,
        )
        other = SimpleNamespace(
            status="ready",
            provider_id="eear",
            identity="eear:2019-eags-enfermagem:single",
            edition_id="2019-eags-enfermagem",
            year=2019,
            phase="single",
            total=100,
        )
        with patch.object(fleet.ingest, "discover_targets", return_value=[other, wanted]):
            plan = fleet._plan(None, wanted.identity, 0)

        self.assertEqual(len(plan["include"]), 1)
        self.assertEqual(plan["include"][0]["identity"], wanted.identity)
        self.assertEqual(plan["include"][0]["selector"], wanted.edition_id)


if __name__ == "__main__":
    unittest.main()
