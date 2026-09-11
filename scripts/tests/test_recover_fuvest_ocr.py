import hashlib
import runpy
import unittest
from pathlib import Path


MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "recover-fuvest-ocr.py")
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def entry():
    return {
        "edition": "2018",
        "year": 2018,
        "total": 2,
        "expectedQuestions": 2,
        "canonicalVariant": "v",
        "contentMode": "reference-only",
        "rightsStatus": "official-reference",
        "validationLevel": "reviewed",
        "answers": {"1": "A", "2": "B"},
        "annulled": [],
        "examUrl": "https://example.test/exam.pdf",
        "answerKeyUrl": "https://example.test/key.pdf",
        "retrieval": {"sha256": sha(b"key")},
    }


def failure(exam_sha: str, key_sha: str):
    return {
        "protocolVersion": "enemlab-extraction-failure/v1",
        "identity": {
            "providerId": "fuvest",
            "sourceId": "fuvest-archive",
            "editionId": "2018",
            "year": 2018,
            "phase": "first",
        },
        "extractor": {"name": "deterministic", "version": "1"},
        "documents": [
            {"url": "https://example.test/exam.pdf", "sha256": exam_sha},
            {"url": "https://example.test/key.pdf", "sha256": key_sha},
        ],
        "error": {"message": "boundaries missing"},
        "fallbackRequest": {
            "targets": [
                {
                    "page": 1,
                    "reason": "incomplete-structure",
                    "message": "recover page 1",
                },
                {
                    "page": 1,
                    "reason": "semantic-fidelity",
                    "message": "same page, second reason",
                },
            ]
        },
    }


class FuvestRasterBoundaryRecoveryTest(unittest.TestCase):
    def test_failure_targets_are_deduplicated_by_page(self):
        exam = b"exam"
        key = b"key"
        manifest = {"2018": entry()}

        _, pages = MODULE["validate_failure_envelope"](
            failure(sha(exam), sha(key)), manifest
        )

        self.assertEqual(pages, [1])

    def test_rejects_failure_from_another_provider(self):
        payload = failure("a" * 64, "b" * 64)
        payload["identity"]["providerId"] = "other"

        with self.assertRaisesRegex(ValueError, "another provider/source"):
            MODULE["validate_failure_envelope"](payload, {"2018": entry()})

    def test_bound_download_rejects_changed_source_bytes(self):
        exam = b"exam"
        key = b"key"
        payload = failure(sha(exam), sha(key))
        function_globals = MODULE["fetch_bound_documents"].__globals__
        original_fetch = function_globals["fetch"]
        function_globals["fetch"] = (
            lambda url: b"changed" if url.endswith("exam.pdf") else key
        )
        try:
            with self.assertRaisesRegex(ValueError, "changed since failure envelope"):
                MODULE["fetch_bound_documents"](payload, entry())
        finally:
            function_globals["fetch"] = original_fetch

    def test_raster_label_shape_gate_is_narrow(self):
        accepted = MODULE["is_raster_label_shape"](
            x_pt=34.7,
            column_start_pt=34.0,
            width_pt=13.7,
            height_pt=9.3,
            density=0.55,
        )
        self.assertTrue(accepted)

        self.assertFalse(
            MODULE["is_raster_label_shape"](
                x_pt=38.0,
                column_start_pt=34.0,
                width_pt=13.7,
                height_pt=9.3,
                density=0.55,
            )
        )
        self.assertFalse(
            MODULE["is_raster_label_shape"](
                x_pt=34.2,
                column_start_pt=34.0,
                width_pt=27.0,
                height_pt=9.3,
                density=0.55,
            )
        )
        self.assertFalse(
            MODULE["is_raster_label_shape"](
                x_pt=34.2,
                column_start_pt=34.0,
                width_pt=13.0,
                height_pt=9.3,
                density=0.20,
            )
        )

    def test_recovery_uses_canonical_key_and_marks_rebuilt_questions_unsafe(self):
        exam = b"exam"
        key = b"key"
        payload = failure(sha(exam), sha(key))
        value = entry()
        native_pages = [
            "01 Primeira.\na) A1\nb) B1\nc) C1\nd) D1\ne) E1",
            "02 Segunda.\na) A2\nb) B2\nc) C2\nd) D2\ne) E2",
        ]
        original_extract = MODULE["BASE"]["extract_pdf_pages"]
        MODULE["BASE"]["extract_pdf_pages"] = lambda _: list(native_pages)
        try:
            envelope = MODULE["build_recovery_envelope"](
                payload,
                value,
                exam,
                key,
                {1: native_pages[0]},
                boundary_labels=[{"number": 1}, {"number": 2}],
                geometry=(34.0, 306.0, 297.5),
            )
        finally:
            MODULE["BASE"]["extract_pdf_pages"] = original_extract

        self.assertEqual(envelope["protocolVersion"], "enemlab-extraction/v1")
        self.assertEqual(
            envelope["extractor"]["name"], "fuvest-raster-boundary-recovery"
        )
        self.assertEqual(envelope["extraction"]["answerKey"], {"1": "A", "2": "B"})
        self.assertTrue(
            any(
                issue.get("questionNumber") == 1
                and issue.get("severity") == "error"
                for issue in envelope["extraction"]["semanticFidelityIssues"]
            )
        )
        self.assertEqual(envelope["recovery"]["pages"], [1])
        self.assertEqual(envelope["recovery"]["boundaryLabels"], 2)
        self.assertEqual(envelope["recovery"]["columnStartsPt"], [34.0, 306.0])
        self.assertEqual(
            envelope["recovery"]["method"], "raster-boundary-reconstruction"
        )
        self.assertTrue(envelope["recovery"]["semanticVerificationRequired"])


if __name__ == "__main__":
    unittest.main()
