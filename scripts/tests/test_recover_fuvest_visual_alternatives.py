import runpy
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "recover-fuvest-visual-alternatives.py")
)


def label(letter, x, y, w=24, h=26, confidence=95.0):
    return {
        "letter": letter,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "confidence": confidence,
    }


class FuvestVisualAlternativeRecoveryTest(unittest.TestCase):
    def test_tsv_filter_requires_strong_small_option_labels(self):
        tsv = "\t".join(
            ["level", "page_num", "block_num", "par_num", "line_num", "word_num", "left", "top", "width", "height", "conf", "text"]
        ) + "\n"
        tsv += "5\t1\t1\t1\t1\t1\t20\t100\t24\t26\t96.0\t(A)\n"
        tsv += "5\t1\t1\t1\t1\t2\t20\t200\t24\t26\t50.0\t(B)\n"
        tsv += "5\t1\t1\t1\t1\t3\t20\t300\t90\t26\t96.0\t(C)\n"
        labels = MODULE["parse_tsv_labels"](tsv)
        self.assertEqual([item["letter"] for item in labels], ["A"])

    def test_selects_unique_vertical_A_to_E_layout(self):
        labels = [
            label("A", 40, 100),
            label("B", 40, 300),
            label("C", 40, 500),
            label("D", 40, 700),
            label("E", 40, 900),
            label("A", 300, 50),
            label("E", 500, 80),
        ]
        layout = MODULE["select_unique_layout"](labels)
        self.assertIsNotNone(layout)
        self.assertEqual(layout["layout"], "vertical")
        boxes = MODULE["alternative_boxes"](800, 1200, layout)
        self.assertEqual(set(boxes), set("ABCDE"))
        self.assertLess(boxes["A"][1], boxes["B"][1])

    def test_selects_standard_two_column_grid_by_letter_not_reading_order(self):
        labels = [
            label("A", 40, 200),
            label("D", 430, 202),
            label("B", 40, 450),
            label("E", 430, 452),
            label("C", 40, 700),
            label("A", 300, 20),
        ]
        layout = MODULE["select_unique_layout"](labels)
        self.assertIsNotNone(layout)
        self.assertEqual(layout["layout"], "two-column-grid")
        boxes = MODULE["alternative_boxes"](800, 1000, layout)
        self.assertLessEqual(boxes["A"][2], 400)
        self.assertGreaterEqual(boxes["D"][0], 400)

    def test_rejects_missing_label_and_ambiguous_geometry(self):
        missing = [
            label("A", 40, 200),
            label("B", 40, 450),
            label("D", 430, 200),
            label("E", 430, 450),
        ]
        self.assertIsNone(MODULE["select_unique_layout"](missing))

        ambiguous = [
            label("A", 40, 100),
            label("A", 42, 105),
            label("B", 40, 300),
            label("C", 40, 500),
            label("D", 40, 700),
            label("E", 40, 900),
        ]
        self.assertIsNone(MODULE["select_unique_layout"](ambiguous))

    def test_one_row_layout_requires_A_to_E_spatial_order(self):
        labels = [
            label("A", 50, 400),
            label("B", 180, 400),
            label("C", 310, 400),
            label("D", 440, 400),
            label("E", 570, 400),
        ]
        layout = MODULE["select_unique_layout"](labels)
        self.assertIsNotNone(layout)
        self.assertEqual(layout["layout"], "one-row")

        wrong = [
            label("A", 50, 400),
            label("D", 180, 400),
            label("B", 310, 400),
            label("E", 440, 400),
            label("C", 570, 400),
        ]
        self.assertIsNone(MODULE["select_unique_layout"](wrong))


if __name__ == "__main__":
    unittest.main()
