from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPTS = Path(__file__).parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import native_ocr_markers as ocr


class NativeOcrMarkerTests(unittest.TestCase):
    def test_tsv_parser_accepts_punctuated_options_and_rejects_bare_letters(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        rows = [
            "5\t1\t1\t1\t1\t1\t100\t200\t20\t20\t90\t[A]\n",
            "5\t1\t1\t1\t2\t1\t100\t240\t20\t20\t90\tB)\n",
            "5\t1\t1\t1\t3\t1\t100\t280\t20\t20\t90\tC\n",
        ]
        labels = ocr.labels_from_tsv(
            header + "".join(rows),
            page_index=0,
            scale=2.0,
        )
        self.assertEqual([label.letter for label in labels], ["A", "B"])
        self.assertEqual(labels[0].x0, 50.0)

    def test_tsv_parser_accepts_bare_letters_only_in_relaxed_mode(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        row = "5\t1\t1\t1\t1\t1\t100\t200\t12\t20\t91\tA\n"
        strict = ocr.labels_from_tsv(header + row, page_index=0, scale=2.0)
        relaxed = ocr.labels_from_tsv(
            header + row,
            page_index=0,
            scale=2.0,
            allow_bare=True,
        )
        self.assertEqual(strict, [])
        self.assertEqual([label.letter for label in relaxed], ["A"])
        self.assertEqual(relaxed[0].font, "__ocr_option_bare__")

    def test_dedupe_merges_same_visual_label_from_two_psm_passes(self):
        first = ocr.option_markers.OptionLabel(
            0, 0, "A", 50.0, 100.0, 58.0, 112.0, "__ocr_option__", 12.0
        )
        second = ocr.option_markers.OptionLabel(
            0, 1, "A", 51.5, 101.0, 59.5, 113.0, "__ocr_option__", 12.0
        )
        self.assertEqual(len(ocr._dedupe_labels([first, second])), 1)

    def test_bare_candidates_require_local_punctuated_neighbors(self):
        label = ocr.option_markers.OptionLabel
        strict = [
            label(0, 0, "A", 50, 100, 58, 112, "__ocr_option__", 12.0),
            label(0, 1, "B", 50, 120, 58, 132, "__ocr_option__", 12.0),
            label(0, 2, "C", 50, 140, 58, 152, "__ocr_option__", 12.0),
            label(0, 3, "D", 50, 160, 58, 172, "__ocr_option__", 12.0),
        ]
        relaxed = [
            label(0, 4, "E", 50, 180, 58, 192, "__ocr_option_bare__", 12.0),
            label(0, 5, "E", 50, 600, 58, 612, "__ocr_option_bare__", 12.0),
        ]
        doc = [SimpleNamespace(rect=SimpleNamespace(width=600.0, height=800.0))]

        accepted = ocr._anchored_bare_labels(
            doc, strict, relaxed, tuple("ABCDE")
        )

        self.assertEqual([(item.letter, item.y0) for item in accepted], [("E", 180)])

    def test_number_tsv_parser_keeps_left_margin_question_number(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        rows = [
            "5\t1\t1\t1\t1\t1\t30\t120\t20\t24\t90\t14\n",
            "5\t1\t1\t1\t2\t1\t800\t40\t20\t20\t90\t3\n",
        ]
        markers = ocr.number_markers_from_tsv(
            header + "".join(rows),
            page_index=0,
            scale=2.0,
            page_width=500.0,
            page_height=700.0,
            total=44,
            marker_factory=lambda **kwargs: kwargs,
        )
        self.assertEqual([item["number"] for item in markers], [14])


if __name__ == "__main__":
    unittest.main()
