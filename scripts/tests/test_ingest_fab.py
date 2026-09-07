import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("ingest_fab", Path(__file__).parents[1] / "ingest-fab.py")
fab = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fab)


def synthetic_text():
    header = "EA CPCAR 2023\nPROVAS DE LINGUA INGLESA - MATEMATICA - LINGUA PORTUGUESA\nGABARITO OFICIAL\nVERSAO A VERSAO B VERSAO C\n"
    rows = [f"{number:02} {'ABCD'[(number - 1) % 4]} {number:02} {'BCDA'[(number - 1) % 4]} {number:02} {'CDAB'[(number - 1) % 4]}" for number in range(1, 49)]
    return header + "\n".join(rows)


class DocumentParserTests(unittest.TestCase):
    def assemble(self, text, booklet=None):
        with patch.object(fab, "texto_do_pdf", return_value=text):
            return fab.montar("epcar", 2023, "https://www.fab.mil.br/key.pdf", b"%PDF-1.4\n%%EOF", "live", "https://www.fab.mil.br/key.pdf", booklet)

    def test_real_epcar_2023_columns_do_not_splice_at_31(self):
        text = (Path(__file__).parent / "fixtures/epcar-2023-columns.txt").read_text(encoding="utf-8")
        columns = fab.ler_colunas(text)
        self.assertEqual([columns["A"][number] for number in range(29, 35)], list("DBBCAB"))
        self.assertEqual([columns["C"][number] for number in range(29, 35)], list("CACBCB"))

    def test_column_splice_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "emenda"):
            fab.ler_colunas("VERSAO A VERSAO B VERSAO C\n30 B 31 D 31 C")

    def test_partial_column_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "emenda"):
            fab.ler_colunas("VERSAO A VERSAO B VERSAO C\n31 B 31 D")

    def test_duplicate_numbers_are_not_overwritten(self):
        with self.assertRaisesRegex(ValueError, "duplicado"):
            fab.ler_colunas("VERSAO A VERSAO B VERSAO C\n01 A 01 B 01 C\n01 D 01 B 01 C")

    def test_independent_document_generates_48_answers(self):
        entry, errors = self.assemble(synthetic_text())
        self.assertEqual(errors, [])
        self.assertEqual(entry["sequence"].replace("|", " ").split(), list("ABCD" * 12))
        self.assertEqual(entry["subjects"], {"english": [1, 16], "mathematics": [17, 32], "portuguese": [33, 48]})

    def test_gap_fails(self):
        entry, errors = self.assemble(synthetic_text().replace("31 C 31 D 31 A", ""))
        self.assertIsNone(entry)
        self.assertTrue(errors)

    def test_preliminary_document_fails_even_with_official_filename(self):
        entry, errors = self.assemble(synthetic_text().replace("GABARITO OFICIAL", "GABARITO PROVISORIO"))
        self.assertIsNone(entry)
        self.assertIn("final", errors[0])

    def test_rectified_document_is_identified(self):
        entry, _ = self.assemble(synthetic_text().replace("GABARITO OFICIAL", "GABARITO OFICIAL RETIFICADO"))
        self.assertEqual(entry["revision"], "rectified")

    def test_wrong_edition_fails(self):
        entry, _ = self.assemble(synthetic_text().replace("CPCAR 2023", "CPCAR 2024"))
        self.assertIsNone(entry)

    def test_wrong_exam_fails(self):
        entry, _ = self.assemble(synthetic_text().replace("CPCAR", "CFOAV/CFOINT/CFOINF"))
        self.assertIsNone(entry)

    def test_annulled_is_preserved(self):
        entry, _ = self.assemble(synthetic_text().replace("31 C", "31 ANULADA"))
        self.assertEqual(entry["annulled"], [31])
        self.assertEqual(entry["variantAnswers"]["a"]["31"], "X")

    def test_invalid_noncanonical_letter_fails(self):
        entry, _ = self.assemble(synthetic_text().replace("31 D", "31 E"))
        self.assertIsNone(entry)

    def test_missing_variant_fails(self):
        entry, _ = self.assemble(synthetic_text().replace("VERSAO C", ""))
        self.assertIsNone(entry)

    def test_partial_booklet_is_not_verified(self):
        with patch.object(fab, "fronteiras_do_caderno", return_value={"english": 1}):
            entry, _ = self.assemble(synthetic_text(), b"booklet")
        self.assertFalse(entry["subjectBoundariesVerified"])

    def test_wrong_booklet_boundary_fails(self):
        with patch.object(fab, "fronteiras_do_caderno", return_value={"english": 17}):
            entry, _ = self.assemble(synthetic_text(), b"booklet")
        self.assertIsNone(entry)

    def test_complete_booklet_boundaries_are_verified(self):
        with patch.object(fab, "fronteiras_do_caderno", return_value={"english": 1, "mathematics": 17, "portuguese": 33}):
            entry, _ = self.assemble(synthetic_text(), b"booklet")
        self.assertTrue(entry["subjectBoundariesVerified"])

    def test_checksum_mismatch_fails_before_parsing(self):
        entry, _ = self.assemble(synthetic_text())
        with self.assertRaisesRegex(ValueError, "checksum"):
            fab.verificar_documento("epcar", entry, b"%PDF-1.4\nchanged\n%%EOF")

    def test_html_cannot_pass_as_pdf(self):
        entry, _ = self.assemble(synthetic_text())
        with self.assertRaisesRegex(ValueError, "PDF"):
            fab.verificar_documento("epcar", entry, b"<html>%%EOF")

    def test_dataset_answer_mismatch_fails(self):
        entry, _ = self.assemble(synthetic_text())
        entry["sequence"] = "D" + entry["sequence"][1:]
        with patch.object(fab, "texto_do_pdf", return_value=synthetic_text()):
            with self.assertRaisesRegex(ValueError, "sequence"):
                fab.verificar_documento("epcar", entry, b"%PDF-1.4\n%%EOF")

    def test_filtered_ingestion_preserves_other_editions(self):
        entry, _ = self.assemble(synthetic_text())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / "src/lib/providers/epcar/answer-keys.generated.json"
            destination.parent.mkdir(parents=True)
            destination.write_text(json.dumps({"2022": {"preserve": True}}))
            with patch.object(fab, "RAIZ", root), patch.object(fab, "descobrir", return_value={2023: ["url"]}), patch.object(fab, "baixar_pdf", return_value=(b"pdf", "live", "url")), patch.object(fab, "montar", return_value=(entry, [])):
                self.assertEqual(fab.executar("epcar", False, False, [2023]), 0)
            self.assertEqual(json.loads(destination.read_text())["2022"], {"preserve": True})

    def test_failed_ingestion_does_not_write(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(fab, "RAIZ", Path(directory)), patch.object(fab, "descobrir", return_value={2023: ["url"]}), patch.object(fab, "baixar_pdf", return_value=None):
                self.assertEqual(fab.executar("epcar", False, False, None), 1)
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
