import runpy
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "extract-fuvest-media.py"),
    run_name="extract_fuvest_media_test",
)
Rect = MODULE["Rect"]
cluster_rectangles = MODULE["cluster_rectangles"]
choose_region = MODULE["choose_region"]
statement_probe = MODULE["statement_probe"]
verify_extraction_envelope = MODULE["verify_extraction_envelope"]


class ExtractFuvestMediaTest(unittest.TestCase):
    def test_statement_probe_normalizes_accents_and_punctuation(self):
        self.assertEqual(
            statement_probe("Observe, no gráfico, a variação da pressão atmosférica."),
            "observe no grafico a variacao da pressao atmosferica",
        )

    def test_cluster_rectangles_merges_parts_of_same_figure(self):
        clusters = cluster_rectangles(
            [
                Rect(10, 10, 40, 40),
                Rect(44, 12, 80, 42),
                Rect(200, 200, 240, 250),
            ],
            gap=8,
        )
        self.assertEqual(len(clusters), 2)
        self.assertEqual(clusters[0], Rect(10, 10, 80, 42))

    def test_choose_region_only_auto_associates_confident_contained_candidate(self):
        number, confidence, association = choose_region(
            Rect(20, 120, 120, 180),
            [(7, 100, 220, True)],
        )
        self.assertEqual(number, 7)
        self.assertGreaterEqual(confidence, 0.98)
        self.assertEqual(association, "automatic")

    def test_choose_region_keeps_continuation_region_for_review(self):
        number, confidence, association = choose_region(
            Rect(20, 20, 120, 80),
            [(6, 0, 100, False)],
        )
        self.assertEqual(number, 6)
        self.assertLess(confidence, 0.98)
        self.assertEqual(association, "review")

    def test_extraction_envelope_requires_sha_bound_objective_document(self):
        envelope = {
            "protocolVersion": "enemlab-extraction/v1",
            "identity": {
                "providerId": "fuvest",
                "sourceId": "fuvest-archive",
                "editionId": "2025",
                "year": 2025,
                "phase": "first",
            },
            "documents": [
                {"url": "https://example.test/prova.pdf", "sha256": "a" * 64},
            ],
            "extraction": {
                "questions": [
                    {
                        "number": 1,
                        "page": 2,
                        "sourceDocumentUrl": "https://example.test/prova.pdf",
                        "statement": "Questão",
                    }
                ],
                "answerKey": {"1": "A"},
            },
        }
        extraction, url, sha = verify_extraction_envelope(envelope)
        self.assertEqual(extraction["questions"][0]["number"], 1)
        self.assertEqual(url, "https://example.test/prova.pdf")
        self.assertEqual(sha, "a" * 64)

        envelope["documents"][0]["sha256"] = "broken"
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            verify_extraction_envelope(envelope)


if __name__ == "__main__":
    unittest.main()
