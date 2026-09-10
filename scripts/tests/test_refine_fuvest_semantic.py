import runpy
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "refine-fuvest-semantic.py"),
    run_name="refine_fuvest_semantic_test",
)


class FuvestSemanticRefinerTest(unittest.TestCase):
    def test_control_character_is_attributed_only_to_active_question(self):
        pages = [
            """
            01 Primeira questão.
            (A) a
            (B) b
            (C) c
            (D) d
            (E) e
            02 Segunda questão com ruído \x01 nesta linha.
            (A) a
            (B) b
            (C) c
            (D) d
            (E) e
            03 Terceira questão.
            (A) a
            (B) b
            (C) c
            (D) d
            (E) e
            """
        ]

        issues = MODULE["precise_raw_semantic_issues"](pages, 3, "v1")

        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["code"], "control-character")
        self.assertEqual(issues[0]["questionNumber"], 2)

    def test_refiner_preserves_non_raw_semantic_findings(self):
        pages = [
            """
            01 Questão com ruído \ue000.
            (A) a
            (B) b
            (C) c
            (D) d
            (E) e
            """
        ]
        envelope = {
            "protocolVersion": "enemlab-extraction/v1",
            "extraction": {
                "questions": [{"number": 1, "statement": "Questão"}],
                "answerKey": {"1": "A"},
                "semanticFidelityIssues": [
                    {
                        "code": "private-use-character",
                        "severity": "error",
                        "questionNumber": 1,
                        "page": 1,
                        "message": "antigo page-wide",
                    },
                    {
                        "code": "formula-ambiguity",
                        "severity": "error",
                        "questionNumber": 1,
                        "page": 1,
                        "message": "fórmula precisa de revisão",
                    },
                ],
            },
        }

        refined = MODULE["refine_envelope"](envelope, pages, "v1")
        issues = refined["extraction"]["semanticFidelityIssues"]

        self.assertTrue(any(issue["code"] == "formula-ambiguity" for issue in issues))
        private = [issue for issue in issues if issue["code"] == "private-use-character"]
        self.assertEqual(len(private), 1)
        self.assertEqual(private[0]["questionNumber"], 1)
        self.assertIn("linha bruta", private[0]["message"])

    def test_refiner_fails_closed_when_boundaries_cannot_be_reconstructed(self):
        with self.assertRaisesRegex(ValueError, "boundaries numéricos"):
            MODULE["precise_raw_semantic_issues"](
                ["Enunciado sem marcador\n(A) a\n(B) b\n(C) c\n(D) d\n(E) e"],
                1,
                "v1",
            )


if __name__ == "__main__":
    unittest.main()
