import hashlib
import runpy
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "recover-fuvest-region-ocr.py")
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def entry():
    return {
        "edition": "2021",
        "year": 2021,
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


def envelope():
    return {
        "protocolVersion": "enemlab-extraction/v1",
        "identity": {
            "providerId": "fuvest",
            "sourceId": "fuvest-archive",
            "editionId": "2021",
            "year": 2021,
            "phase": "first",
        },
        "extractor": {"name": "fuvest-question-text", "version": "test"},
        "documents": [
            {"url": "https://example.test/exam.pdf", "sha256": sha(b"exam")},
            {"url": "https://example.test/key.pdf", "sha256": sha(b"key")},
        ],
        "extraction": {
            "questions": [
                {
                    "number": 1,
                    "page": 2,
                    "statement": "texto corrompido",
                    "sourceDocumentUrl": "https://example.test/exam.pdf",
                },
                {
                    "number": 2,
                    "page": 2,
                    "statement": "Questão preservada",
                    "alternatives": [
                        {"id": letter, "text": f"opção {letter}"}
                        for letter in "ABCDE"
                    ],
                    "sourceDocumentUrl": "https://example.test/exam.pdf",
                },
            ],
            "answerKey": {"1": "A", "2": "B"},
            "annulled": [],
            "subjects": {"Conhecimentos gerais": 2},
            "questionsMissingMedia": [],
            "semanticFidelityIssues": [
                {
                    "code": "control-character",
                    "severity": "error",
                    "questionNumber": 1,
                    "page": 2,
                    "message": "native text is corrupt",
                },
                {
                    "code": "other",
                    "severity": "error",
                    "questionNumber": 2,
                    "page": 2,
                    "message": "keep me",
                },
            ],
            "warnings": ["questão 1: não foi possível separar exatamente as alternativas A-E"],
        },
    }


class FuvestRegionalOcrRecoveryTest(unittest.TestCase):
    def test_candidate_requires_statement_and_exact_A_to_E(self):
        complete = MODULE["parse_ocr_candidate"](
            "01\nEnunciado recuperado.\n(A) Alfa\n(B) Beta\n(C) Gama\n(D) Delta\n(E) Épsilon",
            1,
        )
        incomplete = MODULE["parse_ocr_candidate"](
            "01\nEnunciado recuperado.\n(A) Alfa\n(B) Beta\n(C) Gama\n(D) Delta",
            1,
        )
        self.assertTrue(complete["complete"])
        self.assertEqual([item["id"] for item in complete["alternatives"]], list("ABCDE"))
        self.assertFalse(incomplete["complete"])

    def test_geometry_requires_exact_question_identity_sequence(self):
        labels = [
            {"number": 1, "page": 2, "x0": 34.0, "y0": 40.0},
            {"number": 2, "page": 2, "x0": 34.0, "y0": 300.0},
        ]
        regions = MODULE["build_question_regions"](
            labels, {2: (595.0, 842.0)}, 2
        )
        self.assertEqual([region["number"] for region in regions], [1, 2])
        self.assertEqual(regions[0]["column"], "L")
        self.assertLess(regions[0]["bbox"][1], regions[0]["bbox"][3])

        with self.assertRaisesRegex(ValueError, "exactly at 1..N"):
            MODULE["build_question_regions"](
                [labels[0], {**labels[1], "number": 3}], {2: (595.0, 842.0)}, 2
            )

    def test_layout_profiles_are_explicit_and_filter_label_geometry(self):
        profile_2016 = MODULE["layout_profile"](2016)
        profile_2017 = MODULE["layout_profile"](2017)
        profile_2021 = MODULE["layout_profile"](2021)
        self.assertIsNotNone(profile_2016)
        self.assertIsNotNone(profile_2017)
        self.assertIsNotNone(profile_2021)
        self.assertIsNone(MODULE["layout_profile"](2020))

        self.assertTrue(
            MODULE["label_matches_profile"](
                "1", {"Calibri-Bold"}, 55.6, profile_2016
            )
        )
        self.assertTrue(
            MODULE["label_matches_profile"](
                "90", {"Calibri-Bold"}, 316.3, profile_2017
            )
        )
        self.assertFalse(
            MODULE["label_matches_profile"](
                "20", {"Calibri-Bold"}, 411.1, profile_2016
            )
        )
        self.assertTrue(
            MODULE["label_matches_profile"](
                "01", {"SegoeUIBlack"}, 40.0, profile_2021
            )
        )
        self.assertFalse(
            MODULE["label_matches_profile"](
                "1", {"SegoeUIBlack"}, 40.0, profile_2021
            )
        )

    def test_bound_envelope_rejects_changed_exam_bytes(self):
        with self.assertRaisesRegex(ValueError, "SHA binding mismatch"):
            MODULE["validate_bound_envelope"](
                envelope(), entry(), b"changed", b"key"
            )

    def test_only_incomplete_supported_questions_are_targets(self):
        value = envelope()
        targets = MODULE["validate_bound_envelope"](value, entry(), b"exam", b"key")
        self.assertEqual(targets, [1])
        self.assertTrue(MODULE["should_attempt_region_recovery"](value, entry()))

        supported = entry()
        supported["year"] = 2016
        self.assertTrue(MODULE["should_attempt_region_recovery"](value, supported))

        unsupported = entry()
        unsupported["year"] = 2020
        self.assertFalse(MODULE["should_attempt_region_recovery"](value, unsupported))

    def test_apply_recovery_preserves_key_and_keeps_ocr_semantically_blocked(self):
        value = envelope()
        report = {
            "workerVersion": MODULE["WORKER_VERSION"],
            "attempted": True,
            "applied": True,
            "targetedQuestions": [1],
            "appliedQuestions": [1],
            "unresolvedQuestions": [],
        }
        recovered = {
            1: {
                "number": 1,
                "page": 2,
                "statement": "A figura mostra um exemplo recuperado.",
                "alternatives": [
                    {"id": letter, "text": f"alternativa {letter}"}
                    for letter in "ABCDE"
                ],
                "context": None,
                "complete": True,
                "needsMedia": True,
                "ocrMode": 6,
                "ocrTextSha256": "a" * 64,
            }
        }
        result = MODULE["apply_recovered_questions"](
            value, entry(), recovered, report
        )

        self.assertEqual(result["extraction"]["answerKey"], {"1": "A", "2": "B"})
        self.assertEqual(
            [item["id"] for item in result["extraction"]["questions"][0]["alternatives"]],
            list("ABCDE"),
        )
        self.assertEqual(result["extraction"]["questionsMissingMedia"], [1])
        self.assertFalse(
            any(
                issue["code"] == "control-character" and issue.get("questionNumber") == 1
                for issue in result["extraction"]["semanticFidelityIssues"]
            )
        )
        self.assertTrue(
            any(
                issue["code"] == "extractor-reported"
                and issue.get("questionNumber") == 1
                and issue["severity"] == "error"
                for issue in result["extraction"]["semanticFidelityIssues"]
            )
        )
        self.assertTrue(
            any(issue.get("questionNumber") == 2 for issue in result["extraction"]["semanticFidelityIssues"])
        )
        self.assertEqual(result["recovery"]["method"], "regional-content-ocr")
        self.assertTrue(result["recovery"]["answerKeyPreserved"])

    def test_best_candidate_prefers_complete_structure(self):
        mode, candidate = MODULE["select_best_candidate"](
            [
                (6, "01\ntexto longo mas sem alternativas"),
                (4, "01\nQuestão.\n(A) A\n(B) B\n(C) C\n(D) D\n(E) E"),
            ],
            1,
        )
        self.assertEqual(mode, 4)
        self.assertTrue(candidate["complete"])


if __name__ == "__main__":
    unittest.main()
