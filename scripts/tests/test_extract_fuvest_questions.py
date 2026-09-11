import hashlib
import runpy
import unittest
from pathlib import Path


MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "extract-fuvest-questions.py")
)


class FuvestQuestionExtractorTest(unittest.TestCase):
    def test_legacy_layout_recovers_question_boundaries_and_lowercase_choices(self):
        pages = [
            """
            instruções da prova
            01 Enunciado da primeira questão continua
            em outra linha.
            a) alternativa um
            b) alternativa dois
            c) alternativa três
            d) alternativa quatro
            e) alternativa cinco
            02 Segundo enunciado.
            a) resposta a
            b) resposta b
            c) resposta c
            d) resposta d
            e) resposta e
            V
            """
        ]

        questions = MODULE["parse_questions"](pages, 2, "v")

        self.assertEqual([question.number for question in questions], [1, 2])
        self.assertIn("continua em outra linha", questions[0].statement)
        self.assertEqual(
            [item["id"] for item in questions[0].alternatives],
            ["A", "B", "C", "D", "E"],
        )
        self.assertEqual(questions[1].alternatives[-1]["text"], "resposta e")

    def test_modern_parenthesized_choices_are_supported(self):
        pages = [
            """
            01 Texto objetivo.
            (A) primeira
            (B) segunda
            (C) terceira
            (D) quarta
            (E) quinta
            """
        ]

        question = MODULE["parse_questions"](pages, 1, "v1")[0]

        self.assertEqual(question.statement, "Texto objetivo.")
        self.assertEqual(question.alternatives[2]["text"], "terceira")

    def test_modern_curly_question_marker_is_supported(self):
        pages = [
            """
            Concurso Vestibular FUVEST 2025 – Prova V1
            {01}
            Texto objetivo.
            (A) primeira
            (B) segunda
            (C) terceira
            (D) quarta
            (E) quinta
            #####
            """
        ]

        question = MODULE["parse_questions"](pages, 1, "v1")[0]

        self.assertEqual(question.number, 1)
        self.assertEqual(question.statement, "Texto objetivo.")
        self.assertEqual(question.alternatives[-1]["text"], "quinta")

    def test_mismatched_question_delimiters_are_not_accepted(self):
        pages = [
            """
            {01]
            Enunciado que não deve ganhar identidade estrutural.
            (A) a
            (B) b
            (C) c
            (D) d
            (E) e
            """
        ]

        with self.assertRaisesRegex(ValueError, "cobertura de questões incompleta"):
            MODULE["parse_questions"](pages, 1, "v1")

    def test_numbers_inside_statement_do_not_open_new_questions(self):
        pages = [
            """
            01 Considere os valores a seguir.
            2
            3
            4
            a) um
            b) dois
            c) três
            d) quatro
            e) cinco
            02 Próxima questão.
            a) a
            b) b
            c) c
            d) d
            e) e
            """
        ]

        questions = MODULE["parse_questions"](pages, 2, "v")

        self.assertEqual(len(questions), 2)
        self.assertIn("2 3 4", questions[0].statement)

    def test_incomplete_choice_set_is_staged_for_review_not_invented(self):
        pages = [
            """
            01 Enunciado.
            a) primeira
            b) segunda
            c) terceira
            e) quinta
            """
        ]

        question = MODULE["parse_questions"](pages, 1, "v")[0]

        self.assertIsNone(question.alternatives)
        self.assertTrue(any("alternativas A-E" in warning for warning in question.warnings))

    def test_separator_and_note_do_not_contaminate_choice_e(self):
        pages = [
            """
            {01}
            Enunciado.
            (A) a
            (B) b
            (C) c
            (D) d
            (E) e
            Note e adote:
            gravidade = 10 m/s²
            {02}
            Segundo enunciado.
            (A) a2
            (B) b2
            (C) c2
            (D) d2
            (E) e2
            #####
            """
        ]

        questions = MODULE["parse_questions"](pages, 2, "v1")

        self.assertEqual(questions[0].alternatives[-1]["text"], "e")
        self.assertEqual(questions[0].context, "Note e adote: gravidade = 10 m/s²")
        self.assertEqual(questions[1].alternatives[-1]["text"], "e2")
        self.assertIsNone(questions[1].context)

    def test_unicode_cleanup_preserves_mathematical_superscripts(self):
        self.assertEqual(MODULE["clean_line"]("m/s² e x³"), "m/s² e x³")

    def test_media_reference_is_flagged(self):
        pages = [
            """
            01 Observe o gráfico a seguir e responda.
            a) primeira
            b) segunda
            c) terceira
            d) quarta
            e) quinta
            """
        ]

        question = MODULE["parse_questions"](pages, 1, "v")[0]

        self.assertTrue(question.needs_media_review)

    def test_missing_sequential_question_fails_closed(self):
        pages = [
            """
            01 Primeira.
            a) a
            b) b
            c) c
            d) d
            e) e
            03 Terceira sem a segunda.
            a) a
            b) b
            c) c
            d) d
            e) e
            """
        ]

        with self.assertRaisesRegex(ValueError, "cobertura de questões incompleta"):
            MODULE["parse_questions"](pages, 3, "v")

    def test_many_choice_groups_without_number_markers_require_ocr_boundaries(self):
        blocks = []
        for number in range(1, 6):
            blocks.append(
                f"""
                Enunciado {number} sem glifo numérico recuperável.
                (A) a{number}
                (B) b{number}
                (C) c{number}
                (D) d{number}
                (E) e{number}
                """
            )

        with self.assertRaisesRegex(ValueError, "requer OCR seletivo de boundaries"):
            MODULE["parse_questions"](["\n".join(blocks)], 5, "v")

    def test_envelope_uses_protocol_and_binds_exact_document_hashes(self):
        exam_bytes = b"exam"
        key_bytes = b"answer-key"
        key_sha = hashlib.sha256(key_bytes).hexdigest()
        entry = {
            "edition": "2025",
            "year": 2025,
            "total": 1,
            "canonicalVariant": "v1",
            "answers": {"1": "A"},
            "annulled": [],
            "examUrl": "https://example.test/prova.pdf",
            "answerKeyUrl": "https://example.test/gabarito.pdf",
            "retrieval": {"sha256": key_sha},
        }
        pages = [
            """
            01 Enunciado.
            a) a
            b) b
            c) c
            d) d
            e) e
            """
        ]

        envelope = MODULE["build_envelope"](entry, exam_bytes, key_bytes, pages)

        self.assertEqual(envelope["protocolVersion"], "enemlab-extraction/v1")
        self.assertEqual(envelope["identity"]["providerId"], "fuvest")
        self.assertEqual(
            envelope["documents"][0]["sha256"],
            hashlib.sha256(exam_bytes).hexdigest(),
        )
        self.assertEqual(envelope["documents"][1]["sha256"], key_sha)

    def test_changed_answer_key_hash_is_rejected(self):
        entry = {
            "edition": "2025",
            "year": 2025,
            "total": 1,
            "canonicalVariant": "v1",
            "answers": {"1": "A"},
            "annulled": [],
            "examUrl": "https://example.test/prova.pdf",
            "answerKeyUrl": "https://example.test/gabarito.pdf",
            "retrieval": {"sha256": "0" * 64},
        }
        pages = [
            """
            01 Enunciado.
            a) a
            b) b
            c) c
            d) d
            e) e
            """
        ]

        with self.assertRaisesRegex(ValueError, "gabarito mudou"):
            MODULE["build_envelope"](entry, b"exam", b"new-key", pages)


if __name__ == "__main__":
    unittest.main()
