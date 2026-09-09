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

    def test_udesc_separates_sessions_and_language_columns(self):
        morning = [f"{number} {'Anulada' if number == 9 else 'A'}" for number in range(1, 51)]
        spanish = [f"{number} B" for number in range(29, 37)]
        afternoon = [f"{number} {'Anulada' if number == 14 else 'C'}" for number in range(1, 51)]
        text = "\n".join([
            "UDESC Vestibular - Gabarito Oficial",
            "Período Matutino",
            *morning,
            *spanish,
            "Período Vespertino",
            *afternoon,
        ])

        english_key, spanish_key, afternoon_key = ingest.parse_udesc_answer_key(text)

        self.assertEqual(english_key[0]["29"], "A")
        self.assertEqual(spanish_key[0]["29"], "B")
        self.assertEqual(english_key[1], [9])
        self.assertEqual(afternoon_key[0]["1"], "C")
        self.assertEqual(afternoon_key[1], [14])

    def test_udesc_rejects_missing_language_column(self):
        text = "\n".join([
            "UDESC Vestibular - Gabarito Oficial",
            "Período Matutino",
            *[f"{number} A" for number in range(1, 51)],
            "Período Vespertino",
            *[f"{number} B" for number in range(1, 51)],
        ])
        with self.assertRaisesRegex(ingest.IngestionError, "ocorrências"):
            ingest.parse_udesc_answer_key(text)

    def test_udesc_rejects_preliminary_key(self):
        text = "\n".join([
            "UDESC Vestibular - Gabarito Oficial Preliminar",
            "Período Matutino",
            *[f"{number} A" for number in range(1, 51)],
            *[f"{number} B" for number in range(29, 37)],
            "Período Vespertino",
            *[f"{number} C" for number in range(1, 51)],
        ])
        with self.assertRaisesRegex(ingest.IngestionError, "não é final"):
            ingest.parse_udesc_answer_key(text)

    def test_acafe_preserves_languages_and_annulled_x(self):
        pairs = []
        for number in range(1, 64):
            if number in range(15, 22):
                pairs.extend([f"{number} B", f"{number} A"])
            else:
                pairs.append(f"{number} {'X' if number == 56 else 'C'}")
        text = "\n".join([
            "Vestibular de Medicina ACAFE",
            "Gabarito Oficial",
            "Língua Portuguesa Espanhol Inglês Matemática",
            *pairs,
        ])

        english, spanish = ingest.parse_acafe_answer_key(text)

        self.assertEqual(english[0]["15"], "A")
        self.assertEqual(spanish[0]["15"], "B")
        self.assertEqual(english[1], [56])
        self.assertEqual(spanish[1], [56])

    def test_acafe_rejects_preliminary_key(self):
        text = "\n".join([
            "Vestibular de Medicina ACAFE",
            "Gabarito Oficial Preliminar",
            "Língua Portuguesa Espanhol Inglês Matemática",
        ])
        with self.assertRaisesRegex(ingest.IngestionError, "não é final"):
            ingest.parse_acafe_answer_key(text)

    def test_udesc_rejects_preliminary_key(self):
        text = "\n".join([
            "UDESC Vestibular - Gabarito Oficial Preliminar",
            "Período Matutino",
            *[f"{number} A" for number in range(1, 51)],
            *[f"{number} B" for number in range(29, 37)],
            "Período Vespertino",
            *[f"{number} C" for number in range(1, 51)],
        ])
        with self.assertRaisesRegex(ingest.IngestionError, "não é final"):
            ingest.parse_udesc_answer_key(text)

    def test_discovery_accepts_relative_official_links(self):
        with patch.object(ingest, "fetch_text", return_value='href="../../downloads/pucsp/prova.pdf"'):
            ingest.discover_page_contains(
                "https://nucvest.com.br/pucsp/index.html",
                ["https://nucvest.com.br/downloads/pucsp/prova.pdf"],
            )


if __name__ == "__main__":
    unittest.main()
