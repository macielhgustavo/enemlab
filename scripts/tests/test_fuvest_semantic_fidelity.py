import hashlib
import runpy
import unittest
from pathlib import Path


MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "extract-fuvest-questions.py")
)
ParsedQuestion = MODULE["ParsedQuestion"]


def manifest_entry(answer_key_bytes: bytes) -> dict:
    return {
        "edition": "2018",
        "year": 2018,
        "total": 3,
        "canonicalVariant": "v",
        "examUrl": "https://example.test/prova.pdf",
        "answerKeyUrl": "https://example.test/gabarito.pdf",
        "retrieval": {"sha256": hashlib.sha256(answer_key_bytes).hexdigest()},
    }


class FuvestSemanticFidelityTest(unittest.TestCase):
    def test_control_character_is_reported_before_cleanup(self):
        findings = MODULE["raw_page_semantic_findings"](
            ["Questão 01\nvalor = 3\x10 10² W\n(A) a"]
        )

        self.assertEqual(findings[1][0]["code"], "control-character")

    def test_soft_hyphen_is_not_treated_as_semantic_corruption(self):
        findings = MODULE["raw_page_semantic_findings"](["trans\u00adferência"])

        self.assertEqual(findings, {})

    def test_page_finding_is_bound_to_question_identity(self):
        questions = [
            ParsedQuestion(1, 1, "Primeira", [], None, False, []),
            ParsedQuestion(2, 2, "Segunda", [], None, False, []),
        ]
        issues = MODULE["semantic_issues_for_questions"](
            ["texto limpo", "fórmula \x10 corrompida"], questions
        )

        self.assertTrue(
            any(
                issue["questionNumber"] == 2
                and issue["page"] == 2
                and issue["code"] == "control-character"
                for issue in issues
            )
        )

    def test_failure_envelope_targets_only_pages_with_objective_evidence(self):
        exam_bytes = b"exam"
        key_bytes = b"key"
        pages = [
            "CAPA E INSTRUÇÕES",
            """
            Texto sem número recuperável.
            (A) a
            (B) b
            (C) c
            (D) d
            (E) e
            Outra questão sem número.
            (A) a2
            (B) b2
            (C) c2
            (D) d2
            (E) e2
            """,
            "rodapé sem alternativas",
        ]

        envelope = MODULE["build_failure_envelope"](
            manifest_entry(key_bytes),
            exam_bytes,
            key_bytes,
            pages,
            ValueError("cobertura de questões incompleta"),
        )

        self.assertEqual(
            envelope["protocolVersion"], "enemlab-extraction-failure/v1"
        )
        self.assertEqual(
            envelope["documents"][0]["sha256"], hashlib.sha256(exam_bytes).hexdigest()
        )
        self.assertEqual(
            envelope["documents"][1]["sha256"], hashlib.sha256(key_bytes).hexdigest()
        )
        self.assertTrue(envelope["fallbackRequest"]["targets"])
        self.assertEqual(
            {target["page"] for target in envelope["fallbackRequest"]["targets"]},
            {2},
        )
        self.assertTrue(
            all(target["page"] > 0 for target in envelope["fallbackRequest"]["targets"])
        )

    def test_failure_envelope_is_not_created_without_safe_page_targets(self):
        key_bytes = b"key"

        with self.assertRaisesRegex(ValueError, "não produziu páginas seguras"):
            MODULE["build_failure_envelope"](
                manifest_entry(key_bytes),
                b"exam",
                key_bytes,
                ["somente capa e instruções"],
                ValueError("falha estrutural"),
            )

    def test_failure_envelope_does_not_bypass_answer_key_hash_check(self):
        entry = manifest_entry(b"reviewed-key")

        with self.assertRaisesRegex(ValueError, "gabarito mudou"):
            MODULE["build_failure_envelope"](
                entry,
                b"exam",
                b"different-key",
                ["(A) a\n(B) b\n(C) c\n(D) d\n(E) e"],
                ValueError("falha estrutural"),
            )


if __name__ == "__main__":
    unittest.main()
