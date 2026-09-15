import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "ingest_mass2_sparky.py"
SPEC = importlib.util.spec_from_file_location("ingest_mass2_sparky", MODULE_PATH)
assert SPEC and SPEC.loader
mass2 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mass2)


class SparkyEditionIdentityTests(unittest.TestCase):
    def source(self, provider_id: str):
        return next(spec for spec in mass2.SOURCES if spec.id == provider_id)

    def test_uerj_qualification_exams_are_distinct_editions(self):
        spec = self.source("uerj")
        self.assertEqual(mass2.edition_identity(spec, "UERJ 2019 - 1º Exame de Qualificação"), ("2019-eq1", 2019))
        self.assertEqual(mass2.edition_identity(spec, "UERJ 2019 - 2º Exame de Qualificação"), ("2019-eq2", 2019))

    def test_semester_identity_is_stable(self):
        spec = self.source("cederj")
        self.assertEqual(mass2.edition_identity(spec, "CEDERJ 2025/2 - Prova e gabarito"), ("2025.2", 2025))
        self.assertEqual(mass2.edition_identity(spec, "CEDERJ 2025.1 - Prova e gabarito"), ("2025.1", 2025))

    def test_discursive_and_second_phase_titles_are_rejected(self):
        spec = self.source("uece")
        self.assertFalse(mass2.relevant_title(spec, "UECE 2025.2 - 2ª fase - prova discursiva"))
        self.assertTrue(mass2.relevant_title(spec, "UECE 2025.2 - 1ª fase - prova e gabarito"))


class SparkyAnswerParserTests(unittest.TestCase):
    def spec(self, *, duplicate_policy="reject", option_ids=("A", "B", "C", "D", "E"), minimum=4):
        return mass2.SourceSpec(
            "fixture",
            "Fixture",
            "https://example.test",
            "single",
            option_ids,
            minimum,
            20,
            duplicate_policy,
        )

    def test_reads_contiguous_single_choice_key(self):
        pairs = [(1, "A"), (2, "B"), (3, None), (4, "D")]
        result = mass2.contiguous_map(pairs, self.spec())
        self.assertEqual(result, ({"1": "A", "2": "B", "4": "D"}, [3], 4))

    def test_rejects_conflicting_duplicate_answers(self):
        pairs = [(1, "A"), (1, "B"), (2, "B"), (3, "C"), (4, "D")]
        self.assertIsNone(mass2.contiguous_map(pairs, self.spec()))

    def test_explicit_last_duplicate_policy_is_deterministic(self):
        pairs = [(1, "A"), (2, "B"), (3, "C"), (4, "D"), (4, "A")]
        result = mass2.contiguous_map(pairs, self.spec(duplicate_policy="last"))
        self.assertEqual(result, ({"1": "A", "2": "B", "3": "C", "4": "A"}, [], 4))

    def test_rejects_answer_outside_exam_alphabet(self):
        pairs = [(1, "A"), (2, "B"), (3, "C"), (4, "E")]
        self.assertIsNone(
            mass2.contiguous_map(pairs, self.spec(option_ids=("A", "B", "C", "D")))
        )

    def test_table_rows_are_detected(self):
        text = """
        GABARITO FINAL
        1 2 3 4 5
        A B C D E
        """
        self.assertEqual(
            mass2.row_pairs(text),
            [(1, "A"), (2, "B"), (3, "C"), (4, "D"), (5, "E")],
        )

    def test_summation_format_fails_closed(self):
        member = mass2.PdfMember(
            "gabarito.pdf",
            b"fixture",
            "GABARITO FINAL\nSOMATORIO DAS PROPOSICOES\n1 03\n2 12\n3 05\n4 09",
        )
        with self.assertRaisesRegex(mass2.IngestionError, "resposta única"):
            mass2.parse_answer_key(member, self.spec())


if __name__ == "__main__":
    unittest.main()
