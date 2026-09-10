import runpy
import unittest
from pathlib import Path


MODULE = runpy.run_path(str(Path(__file__).parents[1] / "ingest-fuvest.py"))


class FuvestParserTest(unittest.TestCase):
    def test_direct_table_accepts_fragmented_rows(self):
        rows = []
        for number in range(1, 41):
            rows.extend(
                [
                    f"{number} A\n{number + 40} B",
                    f"{number} C\n{number + 40} D",
                ]
            )
        parsed = MODULE["parse_gabarito"](
            "GABARITO\nPROVA V PROVA K\n" + "\n".join(rows),
            "https://example.test/gabarito.pdf",
        )
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.total, 80)
        self.assertEqual(parsed.versoes["V"][1], "A")
        self.assertEqual(parsed.versoes["K"][80], "D")

    def test_correspondence_table_maps_variant_positions(self):
        rows = []
        for number in range(1, 81):
            rotated = number % 80 + 1
            rows.append(f"A {number} {rotated}")
        parsed = MODULE["parse_gabarito"](
            "GABARITO DE CORRESPONDENCIA\n"
            "RESPOSTA GRUPO V GRUPO K\n"
            + "\n".join(rows),
            "https://example.test/gabarito.pdf",
        )
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.versoes["V"][80], "A")
        self.assertEqual(parsed.versoes["K"][1], "A")

    def test_prefixed_table_preserves_annulled_question(self):
        rows = []
        for number in range(1, 81):
            answer = "ANULADA" if number == 43 else "A"
            rows.append(f"V ? {number:02d} ? {answer} K ? {number:02d} ? B")
        parsed = MODULE["parse_gabarito"](
            "GABARITO\nPROVA V PROVA K\n" + "\n".join(rows),
            "https://example.test/gabarito.pdf",
        )
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.versoes["V"][43], "X")
        self.assertEqual(MODULE["validar"](parsed), [])

    def test_missing_question_fails_closed(self):
        rows = [f"V ? {number:02d} ? A K ? {number:02d} ? B" for number in range(1, 80)]
        parsed = MODULE["parse_gabarito"](
            "GABARITO\nPROVA V PROVA K\n" + "\n".join(rows),
            "https://example.test/gabarito.pdf",
        )
        self.assertIsNone(parsed)

    def test_duplicate_number_fails_closed(self):
        rows = [f"V ? {number:02d} ? A K ? {number:02d} ? B" for number in range(1, 80)]
        rows.extend(["V ? 01 ? A K ? 01 ? B", "V ? 80 ? A K ? 80 ? B"])
        parsed = MODULE["parse_gabarito"](
            "GABARITO\nPROVA V PROVA K\n" + "\n".join(rows),
            "https://example.test/gabarito.pdf",
        )
        self.assertIsNone(parsed)

    def test_discovery_recognizes_historical_and_current_names(self):
        html = """
        <a href="https://www.fuvest.br/wp-content/uploads/fuvest2026-fase1-prova-V1.pdf">Prova</a>
        <a href="https://www.fuvest.br/wp-content/uploads/fuvest2026-fase1-gabarito.pdf">Gabarito</a>
        <a href="https://www.fuvest.br/wp-content/uploads/provao2026-resolucao.pdf">Outro processo</a>
        """
        edition = MODULE["classificar_edicao"](
            2026,
            "https://www.fuvest.br/acervo-vestibular-2026",
            html,
        )
        self.assertTrue(edition.gabarito.endswith("fuvest2026-fase1-gabarito.pdf"))
        self.assertEqual(list(edition.provas), ["V1"])


if __name__ == "__main__":
    unittest.main()
