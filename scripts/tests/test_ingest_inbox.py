import importlib.util
import io
import tempfile
import unittest
import sys
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-inbox.py"
spec = importlib.util.spec_from_file_location("ingest_inbox", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class InboxArchiveTests(unittest.TestCase):
    def test_nested_zip_is_scanned_and_duplicate_pdf_is_deduped(self):
        pdf = b"%PDF-synthetic"
        nested_buffer = io.BytesIO()
        with zipfile.ZipFile(nested_buffer, "w") as nested:
            nested.writestr("copy.pdf", pdf)

        with tempfile.TemporaryDirectory() as tmp:
            archive_path = Path(tmp) / "UNIOESTE_2015.zip"
            with zipfile.ZipFile(archive_path, "w") as outer:
                outer.writestr("direct.pdf", pdf)
                outer.writestr("nested.zip", nested_buffer.getvalue())

            docs = mod.load_documents([archive_path])
            self.assertEqual(len(docs), 1)
            self.assertEqual(docs[0].bytes, pdf)
            self.assertEqual(docs[0].leaf, "direct.pdf")


class InboxParsingTests(unittest.TestCase):
    def test_answer_text_tracks_phase_subject_annulment_and_changed_answer(self):
        text = """
        1ª Etapa (manhã)
        Língua Estrangeira: Inglês
        01 = C 02 = * 03 = **B
        Língua Portuguesa
        04 = D
        2ª Etapa (tarde)
        Física
        01 = A 02 = E anulada
        """
        entries = mod.parse_answer_text(text)
        shapes = [
            (e.phase, e.subject, e.number, e.answer, e.annulled)
            for e in entries
        ]
        self.assertIn(("first", "english", 1, "C", False), shapes)
        self.assertIn(("first", "english", 2, None, True), shapes)
        self.assertIn(("first", "english", 3, "B", False), shapes)
        self.assertIn(("first", "portugues", 4, "D", False), shapes)
        self.assertIn(("second", "fisica", 1, "A", False), shapes)
        self.assertIn(("second", "fisica", 2, None, True), shapes)

    def test_question_parser_accepts_parenthesized_uppercase_and_lowercase_options(self):
        pages = [
            """
            1. Primeira questão?
            (A) alfa
            (B) beta
            (C) gama
            (D) delta
            (E) epsilon
            2. Segunda questão?
            a) um
            b) dois
            c) três
            d) quatro
            e) cinco
            """
        ]
        candidates = mod.question_candidates_from_pages(pages)
        complete = {q.number: q for q in candidates if q.complete}
        self.assertEqual(set(complete), {1, 2})
        self.assertEqual(complete[1].alternatives["A"], "alfa")
        self.assertEqual(complete[2].alternatives["E"], "cinco")

    def test_2018_mislabeled_english_afternoon_is_not_selected_as_morning(self):
        def doc(leaf, text):
            return mod.PdfDocument(
                archive="UNIOESTE_2018.zip",
                member=leaf,
                leaf=leaf,
                bytes=b"x" + leaf.encode(),
                sha256="a" * 64,
                size=1,
                first_text=text,
            )

        docs = [
            doc("UNIOESTE 2018 - MANHÃ - INGLÊS.pdf", "Concurso Vestibular 2018 Provas Vespertinas"),
            doc("UNIOESTE 2018 - MANHÃ - ESPANHOL.pdf", "Concurso Vestibular 2018 Provas Matutinas Espanhol"),
            doc("UNIOESTE 2018 - TARDE.pdf", "Concurso Vestibular 2018 Provas Vespertinas"),
        ]
        units = mod.unioeste_units(2018, docs)
        morning = next(unit for unit in units if unit.id == "morning")
        afternoon = next(unit for unit in units if unit.id == "afternoon")
        self.assertIn("ESPANHOL", morning.exam.leaf)
        self.assertEqual(morning.language, "spanish")
        self.assertEqual(afternoon.exam.leaf, "UNIOESTE 2018 - TARDE.pdf")


if __name__ == "__main__":
    unittest.main()
