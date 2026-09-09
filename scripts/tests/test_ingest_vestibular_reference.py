import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "ingest_vestibular_reference",
    Path(__file__).parents[1] / "ingest_vestibular_reference.py",
)
ingest = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ingest
SPEC.loader.exec_module(ingest)


class VestibularReferenceParserTests(unittest.TestCase):
    def test_unicamp_keeps_leading_zeroes_and_annulled_star(self):
        text = "\n".join(
            [
                "01 B 19 A 37 D 55 B",
                *[f"{n:02} A" for n in range(2, 19)],
                *[f"{n:02} B" for n in range(20, 37)],
                *[f"{n:02} C" for n in range(38, 53)],
                "53 *",
                "54 D",
                *[f"{n:02} E" for n in range(56, 73)],
                "GABARITO DA PROVA DE CONHECIMENTOS GERAIS - 1ª FASE",
            ]
        )
        answers, annulled = ingest.parse_unicamp_answer_key(text)
        self.assertEqual(answers["1"], "B")
        self.assertEqual(answers["72"], "E")
        self.assertEqual(annulled, [53])

    def test_uel_rejects_preliminary_key(self):
        text = "GABARITO OFICIAL PROVISÓRIO\n" + "\n".join(f"{n} A" for n in range(1, 61))
        with self.assertRaisesRegex(ingest.IngestionError, "definitivo"):
            ingest.parse_uel_answer_key(text)

    def test_uel_ignores_footer_after_annulment_note(self):
        lines = ["GABARITO OFICIAL DEFINITIVO", "Questão Alternativa correta Assinalada"]
        lines += [f"{n} {'*' if n == 41 else 'A'}" for n in range(1, 61)]
        lines += ["22 / 22", "* Pontos atribuídos para todos os candidatos."]
        answers, annulled = ingest.parse_uel_answer_key("\n".join(lines))
        self.assertEqual(len(answers), 59)
        self.assertEqual(annulled, [41])

    def test_pucsp_preserves_rectified_annulment(self):
        text = "VESTIBULAR PUC-SP VERÃO 2025\n" + "\n".join(
            f"{n} {'ANULADA (*)' if n == 12 else 'B'}" for n in range(1, 51)
        )
        answers, annulled = ingest.parse_pucsp_answer_key(text)
        self.assertEqual(annulled, [12])
        self.assertNotIn("12", answers)

    def test_duplicate_number_fails_closed(self):
        with self.assertRaisesRegex(ingest.IngestionError, "duplicada"):
            ingest.pairs_to_answers([("1", "A"), ("1", "B")], 1)

    def test_discovery_accepts_relative_official_links(self):
        with patch.object(ingest, "fetch_text", return_value='href="../../downloads/pucsp/prova.pdf"'):
            ingest.discover_page_contains(
                "https://nucvest.com.br/pucsp/index.html",
                ["https://nucvest.com.br/downloads/pucsp/prova.pdf"],
            )


if __name__ == "__main__":
    unittest.main()
