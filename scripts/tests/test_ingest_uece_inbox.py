from __future__ import annotations

import importlib.util
import tempfile
import unittest
import sys
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-uece-inbox.py"
SPEC = importlib.util.spec_from_file_location("ingest_uece_inbox", SCRIPT)
assert SPEC and SPEC.loader
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)


class UeceParsingTests(unittest.TestCase):
    def test_expected_count_and_cycle_from_cover(self) -> None:
        class Doc:
            first_text = "VESTIBULAR 2026.1 - 1ª FASE - Prova de Conhecimentos Gerais contendo 85 questões"

        source = mod.Source(Path("uece.zip"), {"title": "Provas e gabaritos UECE 2026"})
        self.assertEqual(mod.expected(Doc()), 85)
        self.assertEqual(mod.cycle(Doc.first_text, source), (2026, 1))

    def test_question_parser_preserves_shared_text_and_four_alternatives(self) -> None:
        pages = [
            """
            LÍNGUA PORTUGUESA
            TEXTO 1
            Este é um texto compartilhado pelas questões seguintes.
            01. Qual é a resposta correta?
            A) alfa
            B) beta
            C) gama
            D) delta
            """
        ]
        questions = mod.parse_questions(pages)
        self.assertEqual(len(questions), 1)
        question = questions[0]
        self.assertTrue(question.complete)
        self.assertEqual(question.number, 1)
        self.assertEqual(question.subject, "portugues")
        self.assertIn("texto compartilhado", question.context.lower())
        self.assertEqual(set(question.alts), {"A", "B", "C", "D"})

    def test_repeated_language_numbers_choose_english(self) -> None:
        def candidate(subject: str, statement: str):
            return mod.Candidate(
                number=78,
                subject=subject,
                label=subject,
                statement=statement,
                context="",
                alts={"A": "a", "B": "b", "C": "c", "D": "d"},
                page=1,
                mode="plain",
            )

        selected, missing = mod.choose_questions(
            [candidate("spanish", "espanhol"), candidate("english", "english")],
            78,
        )
        self.assertNotIn(78, missing)
        self.assertEqual(selected[78].statement, "english")

    def test_key_parser_selects_english_gabarito_one_and_annulment(self) -> None:
        text = """
        LÍNGUA INGLESA
        GABARITO 1
        78 79 80 81 82 83 84 85
        A B X D C A B D
        GABARITO 2
        78 79 80 81 82 83 84 85
        D D D D D D D D
        """
        answers = mod.parse_key_text(text, 85)
        self.assertEqual(answers[78], "A")
        self.assertEqual(answers[79], "B")
        self.assertIsNone(answers[80])
        self.assertEqual(answers[85], "D")

    def test_key_parser_refuses_non_english_language_only(self) -> None:
        text = """
        LÍNGUA ESPANHOLA
        GABARITO 1
        78 79 80 81
        A B C D
        """
        self.assertEqual(mod.parse_key_text(text, 85), {})

    def test_recursive_inputs_and_sidecar_detect_provider(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nested = root / "universidade-estadual-ceara" / "2026"
            nested.mkdir(parents=True)
            archive = nested / "47772-provas-e-gabaritos-uece-2026.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("placeholder.txt", "x")
            archive.with_suffix(".zip.meta.json").write_text(
                '{"institutionSlug":"universidade-estadual-ceara","institution":"UECE","title":"Provas e gabaritos UECE 2026"}',
                encoding="utf-8",
            )

            paths = mod.inputs([str(root)])
            self.assertEqual(paths, [archive])
            source = mod.Source(archive, mod.sidecar(archive))
            self.assertTrue(mod.is_uece(source))


if __name__ == "__main__":
    unittest.main()
