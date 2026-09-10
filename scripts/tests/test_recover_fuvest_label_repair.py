import runpy
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "recover-fuvest-region-ocr.py")
)


class FuvestLabelRepairTest(unittest.TestCase):
    def test_repairs_single_misread_label_when_five_linear_blocks_are_proven(self):
        text = "\n".join(
            [
                "08",
                "Enunciado com contexto suficiente para a questão.",
                "a) 1/5",
                "b) 2/5",
                "c) 3/5",
                "a) 4/5",
                "e) 5/5",
            ]
        )
        candidate = MODULE["parse_ocr_candidate_with_label_repair"](text, 8)
        self.assertTrue(candidate["complete"])
        self.assertTrue(candidate["labelRepair"])
        self.assertEqual(candidate["labelRepairPositionalMatches"], 4)
        self.assertEqual(
            [item["id"] for item in candidate["alternatives"]], list("ABCDE")
        )

    def test_repairs_delimiter_noise_without_changing_option_order(self):
        text = "\n".join(
            [
                "40",
                "Enunciado textual suficientemente longo.",
                "(AJA primeira alternativa",
                "(B) segunda alternativa",
                "(C) terceira alternativa",
                "(D) quarta alternativa",
                "(E) quinta alternativa",
            ]
        )
        candidate = MODULE["parse_ocr_candidate_with_label_repair"](text, 40)
        self.assertTrue(candidate["complete"])
        self.assertTrue(candidate["labelRepair"])
        self.assertEqual(candidate["alternatives"][0]["text"], "A primeira alternativa")

    def test_rejects_graphical_out_of_order_option_layout(self):
        text = "\n".join(
            [
                "57",
                "Enunciado textual suficientemente longo.",
                "a) gráfico um",
                "d) gráfico quatro",
                "b) gráfico dois",
                "e) gráfico cinco",
                "c) gráfico três",
            ]
        )
        candidate = MODULE["parse_ocr_candidate_with_label_repair"](text, 57)
        self.assertFalse(candidate["complete"])
        self.assertFalse(candidate.get("labelRepair", False))

    def test_rejects_incomplete_evidence(self):
        text = "\n".join(
            [
                "01",
                "Enunciado textual suficientemente longo.",
                "(A) uma",
                "(B) duas",
                "(C) três",
                "(D) quatro",
            ]
        )
        candidate = MODULE["parse_ocr_candidate_with_label_repair"](text, 1)
        self.assertFalse(candidate["complete"])
        self.assertFalse(candidate.get("labelRepair", False))


if __name__ == "__main__":
    unittest.main()
