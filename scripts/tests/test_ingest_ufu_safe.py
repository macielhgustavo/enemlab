import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-ufu-safe.py"
spec = importlib.util.spec_from_file_location("ingest_ufu_safe_tested", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class UfuGrammarTests(unittest.TestCase):
    def test_key_uses_type_one_column(self):
        text = """
        TIPO 01 TIPO 02 TIPO 03 TIPO 04
        DISCIP. QUES. ALTER. QUES. ALTER. QUES. ALTER. QUES. ALTER.
        Biologia
        1 C 1 B 1 D 1 A
        2 D 2 A 2 C 2 B
        Filosofia
        9 A 9 D 9 B 9 C
        """
        self.assertEqual(mod.parse_key_text(text), {1: "C", 2: "D", 9: "A"})

    def test_key_prefers_english_duplicate_language_block(self):
        text = """
        Espanhol
        41 A 41 B 41 C 41 D
        42 B 42 A 42 D 42 C
        Inglês
        41 D 41 C 41 B 41 A
        42 C 42 D 42 A 42 B
        """
        self.assertEqual(mod.parse_key_text(text)[41], "D")
        self.assertEqual(mod.parse_key_text(text)[42], "C")

    def test_key_accepts_annulment_n_marker(self):
        self.assertEqual(mod.parse_key_text("68 N 68 B 68 C 68 D"), {68: None})

    def test_exam_parses_multiline_four_choice_question(self):
        text = """
        PROVA OBJETIVA
        1. Esta prova é composta de 88 questões objetivas de múltipla escolha.
        BIOLOGIA
        QUESTÃO 01
        Um enunciado que continua
        na linha seguinte.
        A) alternativa A
        continuação A
        B) alternativa B
        C) alternativa C
        D) alternativa D
        QUESTÃO 02
        Outro enunciado.
        A) A2
        B) B2
        C) C2
        D) D2
        """
        qmap, expected = mod.parse_exam_text(text)
        self.assertEqual(expected, 88)
        self.assertEqual(sorted(qmap), [1, 2])
        self.assertIn("continua na linha", qmap[1]["statement"])
        self.assertEqual(qmap[1]["alternatives"]["A"], "alternativa A continuação A")

    def test_exam_accepts_inline_question_and_alternative_variants(self):
        text = """
        1. Esta prova é composta por 65 questões objetivas de múltipla escolha.
        BIOLOGIA
        QUESTÃO 22: Enunciado na mesma linha
        (A) primeira
        B. segunda
        C - terceira
        D) quarta
        """
        qmap, expected = mod.parse_exam_text(text)
        self.assertEqual(expected, 65)
        self.assertEqual(qmap[22]["statement"], "Enunciado na mesma linha")
        self.assertEqual(qmap[22]["alternatives"]["C"], "terceira")

    def test_exam_prefers_english_when_identity_repeats(self):
        text = """
        1. Esta prova é composta por 65 questões objetivas de múltipla escolha.
        ESPANHOL
        QUESTÃO 31
        Texto espanhol.
        A) uno
        B) dos
        C) tres
        D) quatro
        INGLÊS
        QUESTÃO 31
        English text.
        A) one
        B) two
        C) three
        D) four
        """
        qmap, expected = mod.parse_exam_text(text)
        self.assertEqual(expected, 65)
        self.assertEqual(qmap[31]["subject"], "Inglês")
        self.assertEqual(qmap[31]["alternatives"]["A"], "one")

    def test_regular_except_medicine_is_not_denied(self):
        class Doc:
            member = "Prova - Dia 1 - Todos os cursos, exceto Medicina.pdf"
            page_count = 44

        text = "PROVA OBJETIVA\nTIPO 1\nTodos os cursos, exceto Medicina"
        self.assertTrue(mod.eligible_exam(Doc(), text))


if __name__ == "__main__":
    unittest.main()
