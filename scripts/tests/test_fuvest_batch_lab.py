import json
import runpy
import tempfile
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "fuvest-batch-lab.py"),
    run_name="fuvest_batch_lab_test",
)
attempt_proven_font_recovery = MODULE["attempt_proven_font_recovery"]
content_cache_key = MODULE["content_cache_key"]
load_valid_extraction_cache = MODULE["load_valid_extraction_cache"]
parse_years = MODULE["parse_years"]
regional_result_is_cacheable = MODULE["regional_result_is_cacheable"]
summarize = MODULE["summarize"]


class FuvestBatchLabTest(unittest.TestCase):
    def test_cache_key_changes_with_parser_version_or_document_sha(self):
        first = content_cache_key("fuvest", "v1", "2025", "a" * 64)
        self.assertNotEqual(first, content_cache_key("fuvest", "v2", "2025", "a" * 64))
        self.assertNotEqual(first, content_cache_key("fuvest", "v1", "2025", "b" * 64))

    def test_cached_extraction_must_match_both_document_hashes(self):
        envelope = {
            "protocolVersion": "enemlab-extraction/v1",
            "identity": {"editionId": "2025", "year": 2025},
            "documents": [
                {"url": "https://example.test/prova.pdf", "sha256": "a" * 64},
                {"url": "https://example.test/gabarito.pdf", "sha256": "b" * 64},
            ],
            "extraction": {"questions": [], "answerKey": {}},
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cache.json"
            path.write_text(json.dumps(envelope), encoding="utf-8")
            cached = load_valid_extraction_cache(
                path,
                2025,
                "https://example.test/prova.pdf",
                "a" * 64,
                "https://example.test/gabarito.pdf",
                "b" * 64,
            )
            self.assertIsNotNone(cached)
            stale = load_valid_extraction_cache(
                path,
                2025,
                "https://example.test/prova.pdf",
                "c" * 64,
                "https://example.test/gabarito.pdf",
                "b" * 64,
            )
            self.assertIsNone(stale)

    def test_font_recovery_is_not_attempted_for_clean_pages(self):
        pages = ["Questão 01\nTexto sem glifo suspeito"]
        repaired, report = attempt_proven_font_recovery(b"not-a-pdf", pages)
        self.assertIs(repaired, pages)
        self.assertFalse(report["attempted"])
        self.assertFalse(report["applied"])
        self.assertEqual(report["resolvedOccurrences"], 0)

    def test_missing_regional_ocr_dependency_is_not_checkpointed(self):
        self.assertFalse(
            regional_result_is_cacheable({"rejectedReason": "tesseract-not-installed"})
        )
        self.assertFalse(
            regional_result_is_cacheable({"rejectedReason": "pymupdf-not-installed"})
        )
        self.assertTrue(regional_result_is_cacheable({"attempted": True, "applied": True}))
        self.assertTrue(
            regional_result_is_cacheable({"rejectedReason": "no-structural-improvement"})
        )

    def test_default_years_skip_reference_only_edition_without_exam_pdf(self):
        manifest = {
            "2022": {"examUrl": None, "answerKeyUrl": "https://example.test/key.pdf"},
            "2023": {
                "examUrl": "https://example.test/exam.pdf",
                "answerKeyUrl": "https://example.test/key.pdf",
            },
        }
        self.assertEqual(parse_years(None, manifest), [2023])
        with self.assertRaisesRegex(ValueError, "sem caderno revisado"):
            parse_years("2022", manifest)

    def test_summary_preserves_mapped_metrics_and_cache_hits(self):
        value = summarize(
            [
                {
                    "year": 2025,
                    "questions": 90,
                    "completeStructure": 88,
                    "missingMedia": 29,
                    "semanticIssues": 2,
                    "needsTextReview": 2,
                    "recovered": False,
                    "fontMapAttempted": True,
                    "fontMapApplied": True,
                    "fontMapResolvedOccurrences": 123,
                    "fontMapUnresolvedOccurrences": 4,
                    "regionalRecoveryAttempted": True,
                    "regionalRecoveryApplied": True,
                    "regionalRecoveryTargetedQuestions": 10,
                    "regionalRecoveryAppliedQuestions": 8,
                    "regionalRecoveryUnresolvedQuestions": 2,
                    "extractionCacheHit": True,
                    "mediaAssets": 65,
                    "mediaAutomatic": 46,
                    "mediaReview": 19,
                    "questionsWithAutomaticMedia": 27,
                    "mediaCacheHit": True,
                }
            ]
        )
        self.assertEqual(value["editions"], 1)
        self.assertEqual(value["questions"], 90)
        self.assertEqual(value["completeStructure"], 88)
        self.assertEqual(value["needsTextReview"], 2)
        self.assertEqual(value["fontMapAttemptedEditions"], 1)
        self.assertEqual(value["fontMapAppliedEditions"], 1)
        self.assertEqual(value["fontMapResolvedOccurrences"], 123)
        self.assertEqual(value["fontMapUnresolvedOccurrences"], 4)
        self.assertEqual(value["regionalRecoveryAttemptedEditions"], 1)
        self.assertEqual(value["regionalRecoveryAppliedEditions"], 1)
        self.assertEqual(value["regionalRecoveryTargetedQuestions"], 10)
        self.assertEqual(value["regionalRecoveryAppliedQuestions"], 8)
        self.assertEqual(value["regionalRecoveryUnresolvedQuestions"], 2)
        self.assertEqual(value["extractionCacheHits"], 1)
        self.assertEqual(value["mediaCacheHits"], 1)


if __name__ == "__main__":
    unittest.main()
