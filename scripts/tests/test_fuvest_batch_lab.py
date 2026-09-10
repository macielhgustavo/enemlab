import json
import runpy
import tempfile
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "fuvest-batch-lab.py"),
    run_name="fuvest_batch_lab_test",
)
content_cache_key = MODULE["content_cache_key"]
load_valid_extraction_cache = MODULE["load_valid_extraction_cache"]
parse_years = MODULE["parse_years"]


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


if __name__ == "__main__":
    unittest.main()
