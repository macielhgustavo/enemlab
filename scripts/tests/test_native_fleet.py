import importlib.util
import sys
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
