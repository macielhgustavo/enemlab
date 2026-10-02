from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPTS = Path(__file__).parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

SPEC = importlib.util.spec_from_file_location(
    "native_coverage_report",
    SCRIPTS / "native_coverage_report.py",
)
assert SPEC and SPEC.loader
coverage = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = coverage
SPEC.loader.exec_module(coverage)


def target(
    *,
    provider_id: str = "unesp",
    year: int = 2026,
    phase: str = "first",
    edition_id: str | None = None,
    total: int = 2,
    status: str = "ready",
    reason: str | None = None,
):
    return SimpleNamespace(
        provider_id=provider_id,
        year=year,
        phase=phase,
        edition_id=edition_id,
        total=total,
        status=status,
        reason=reason,
    )


def pack(*, resolved: bool = True, markers: int = 2, expected: int = 2):
    questions = []
    for number in range(1, expected + 1):
        questions.append(
            {
                "questionKey": f"unesp-2026-first-{number}",
                "providerId": "unesp",
                "year": 2026,
                "phase": "first",
                "number": number,
                "documentId": "unesp-2026-first",
                "visualRegions": [
                    {
                        "page": 1,
                        "role": "question",
                        "rect": {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.2},
                    }
                ],
                "extraction": {
                    "parserVersion": "native-pipeline@2.0.0",
                    "markerDetected": True,
                    "issues": [],
                    "visualCompleteness": {
                        "required": not resolved,
                        "resolved": resolved,
                        "reasons": [],
                        "strategy": "not-required" if resolved else "manual",
                    },
                },
            }
        )
    return {
        "documents": [
            {
                "documentId": "unesp-2026-first",
                "providerId": "unesp",
                "year": 2026,
                "phase": "first",
                "sourceSha256": "a" * 64,
                "sourceBytes": 123,
                "pageCount": 1,
                "renderScale": 1.5,
            }
        ],
        "questions": questions,
        "reviewSummary": {"markers": markers, "expected": expected},
    }


class NativeCoverageReportTests(unittest.TestCase):
    def test_pending_without_runtime_data_does_not_invent_renderable_count(self):
        with tempfile.TemporaryDirectory() as temp:
            row = coverage.coverage_row_for_target(target(), Path(temp))

        self.assertEqual(row.fleet_state, "pending")
        self.assertIsNone(row.renderable)
        self.assertEqual(row.total, 2)
        self.assertIsNone(row.failure_category)

    def test_blocked_source_becomes_unavailable_source_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            row = coverage.coverage_row_for_target(
                target(status="blocked", reason="caderno objetivo sem URL no catálogo"),
                Path(temp),
            )

        self.assertEqual(row.fleet_state, "unavailable")
        self.assertEqual(row.failure_category, "source")

    def test_ocr_preparation_blocker_is_prepare_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            row = coverage.coverage_row_for_target(
                target(status="blocked", reason="PDF digitalizado: preparar requer OCR/revisão visual"),
                Path(temp),
            )

        self.assertEqual(row.fleet_state, "unavailable")
        self.assertEqual(row.failure_category, "prepare")

    def test_local_pack_with_all_questions_renderable_is_healthy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "unesp" / "2026" / "first"
            output.mkdir(parents=True)
            (output / "native-pack.json").write_text(json.dumps(pack()), encoding="utf-8")

            row = coverage.coverage_row_for_target(target(), root)

        self.assertEqual(row.fleet_state, "healthy")
        self.assertEqual(row.renderable, 2)
        self.assertEqual(row.failure_category, None)

    def test_marker_gap_is_reported_as_missing_markers(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "unesp" / "2026" / "first"
            output.mkdir(parents=True)
            (output / "native-pack.json").write_text(
                json.dumps(pack(markers=1, expected=2)),
                encoding="utf-8",
            )

            row = coverage.coverage_row_for_target(target(), root)

        self.assertEqual(row.fleet_state, "degraded")
        self.assertEqual(row.failure_category, "missing-markers")

    def test_unresolved_visual_dependency_is_layout_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "unesp" / "2026" / "first"
            output.mkdir(parents=True)
            (output / "native-pack.json").write_text(
                json.dumps(pack(resolved=False)),
                encoding="utf-8",
            )

            row = coverage.coverage_row_for_target(target(), root)

        self.assertEqual(row.fleet_state, "degraded")
        self.assertEqual(row.renderable, 0)
        self.assertEqual(row.failure_category, "layout")

    def test_markdown_documents_local_runtime_limitation(self):
        markdown = coverage.render_markdown([
            coverage.CoverageRow("unesp", "2026", "first", "pending", None, 90, None, "sem NativePack local"),
        ])

        self.assertIn("Sem dados de runtime", markdown)
        self.assertIn("| unesp | 2026 | first | pending | — | — | sem NativePack local |", markdown)


if __name__ == "__main__":
    unittest.main()
