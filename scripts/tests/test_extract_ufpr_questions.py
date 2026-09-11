from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "extract-ufpr-questions.py"
SPEC = importlib.util.spec_from_file_location("extract_ufpr_questions", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load UFPR extractor")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def alternatives(correct: str | None) -> str:
    lines = []
    for letter in "abcde":
        marker = "►" if correct == letter.upper() else ""
        lines.append(f"{marker}{letter}) alternativa {letter}")
    return "\n".join(lines)


class UfprQuestionExtractorTest(unittest.TestCase):
    def test_selects_english_when_language_numbers_repeat(self) -> None:
        pages = [
            f"""
INGLÊS
1 - English statement
{alternatives("A")}
ALEMÃO
1 - German statement
{alternatives("B")}
"""
        ]

        extraction = MODULE.build_extraction(
            pages,
            year=2022,
            expected_count=1,
            variant="english",
            source_url="https://official.example/ps2022.pdf",
        )

        self.assertEqual(extraction["answerKey"], {1: "A"})
        self.assertEqual(extraction["questions"][0]["statement"], "English statement")

    def test_accepts_starred_annulled_question_without_marked_answer(self) -> None:
        pages = [
            f"""
1 - Questão válida
{alternatives("C")}
*2 - Questão anulada
{alternatives(None)}
"""
        ]

        extraction = MODULE.build_extraction(
            pages,
            year=2024,
            expected_count=2,
            variant="english",
            source_url="https://official.example/ps2024.pdf",
        )

        self.assertEqual(extraction["answerKey"], {1: "C"})
        self.assertEqual(extraction["annulled"], [2])

    def test_double_star_is_editorial_marker_not_automatic_annulment(self) -> None:
        pages = [
            f"""
**1 - Questão com nota editorial
{alternatives("B")}
"""
        ]

        extraction = MODULE.build_extraction(
            pages,
            year=2024,
            expected_count=1,
            variant="english",
            source_url="https://official.example/ps2024.pdf",
        )

        self.assertEqual(extraction["answerKey"], {1: "B"})
        self.assertEqual(extraction["annulled"], [])

    def test_double_star_can_be_annulled_by_explicit_global_note(self) -> None:
        pages = [
            f"""
**1 - Questão posteriormente anulada
{alternatives(None)}
A questão 1 será anulada para todos os candidatos.
"""
        ]

        extraction = MODULE.build_extraction(
            pages,
            year=2024,
            expected_count=1,
            variant="english",
            source_url="https://official.example/ps2024.pdf",
        )

        self.assertEqual(extraction["answerKey"], {})
        self.assertEqual(extraction["annulled"], [1])

    def test_detects_global_annulment_note(self) -> None:
        pages = [
            f"""
1 - Questão válida
{alternatives("A")}
2 - Questão posteriormente anulada
{alternatives(None)}
A questão 2 será anulada para todos os candidatos.
"""
        ]

        extraction = MODULE.build_extraction(
            pages,
            year=2024,
            expected_count=2,
            variant="english",
            source_url="https://official.example/ps2024.pdf",
        )

        self.assertEqual(extraction["annulled"], [2])
        self.assertNotIn(2, extraction["answerKey"])

    def test_ignores_incomplete_numbered_passage_when_real_question_is_complete(self) -> None:
        pages = [
            f"""
1 - Questão objetiva real
{alternatives("D")}
INGLÊS
1 - Human beings are terrible drivers.
This is a numbered sentence inside the passage, not question one.
"""
        ]

        extraction = MODULE.build_extraction(
            pages,
            year=2017,
            expected_count=1,
            variant="english",
            source_url="https://official.example/ps2017.pdf",
        )

        self.assertEqual(extraction["answerKey"], {1: "D"})
        self.assertEqual(extraction["questions"][0]["statement"], "Questão objetiva real")

    def test_fails_closed_when_a_non_annulled_answer_marker_is_missing(self) -> None:
        pages = [
            f"""
1 - Questão incompleta
{alternatives(None)}
"""
        ]

        with self.assertRaises(MODULE.ExtractionFailure) as caught:
            MODULE.build_extraction(
                pages,
                year=2024,
                expected_count=1,
                variant="english",
                source_url="https://official.example/ps2024.pdf",
            )

        self.assertEqual(caught.exception.targets[0]["questionNumber"], 1)
        self.assertEqual(caught.exception.targets[0]["reason"], "incomplete-structure")


if __name__ == "__main__":
    unittest.main()
