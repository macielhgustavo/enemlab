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

    def test_adaptive_tsv_filter_accepts_only_explicit_lower_confidence_labels(self):
        header = "\t".join(
            ["level", "page_num", "block_num", "par_num", "line_num", "word_num", "left", "top", "width", "height", "conf", "text"]
        ) + "\n"
        tsv = header
        tsv += "5\t1\t1\t1\t1\t1\t20\t100\t24\t26\t60.0\t(A)\n"
        tsv += "5\t1\t1\t1\t1\t2\t20\t200\t24\t26\t99.0\tB\n"
        labels = MODULE["parse_tsv_labels"](
            tsv, minimum_confidence=55.0, explicit_only=True
        )
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

    def test_infers_one_row_from_two_adjacent_explicit_bottom_labels(self):
        labels = [
            {**label("B", 200, 1000), "explicit": True},
            {**label("C", 330, 1001), "explicit": True},
            {**label("A", 50, 100), "explicit": False},
        ]
        layout = MODULE["infer_one_row_layout"](labels, 800, 1125)
        self.assertIsNotNone(layout)
        self.assertEqual(layout["layout"], "one-row")
        self.assertEqual(layout["inferredLabels"], ["A", "D", "E"])
        boxes = MODULE["alternative_boxes"](800, 1125, layout)
        self.assertLess(boxes["A"][1], 950)
        self.assertEqual(set(boxes), set("ABCDE"))

    def test_does_not_infer_row_from_bare_or_non_bottom_labels(self):
        bare = [
            {**label("B", 200, 1000), "explicit": False},
            {**label("C", 330, 1000), "explicit": False},
        ]
        self.assertIsNone(MODULE["infer_one_row_layout"](bare, 800, 1125))
        statement = [
            {**label("B", 200, 200), "explicit": True},
            {**label("C", 330, 200), "explicit": True},
        ]
        self.assertIsNone(MODULE["infer_one_row_layout"](statement, 800, 1125))

    def test_consensus_rejects_conflicting_layouts(self):
        vertical = {
            "layout": "vertical",
            "labels": {letter: label(letter, 40, index * 180 + 100) for index, letter in enumerate("ABCDE")},
            "mode": 11,
        }
        row = {
            "layout": "one-row",
            "labels": {letter: label(letter, index * 130 + 50, 400) for index, letter in enumerate("ABCDE")},
            "mode": 6,
        }
        self.assertIsNone(MODULE["_select_consensus_layout"]([vertical, row]))


if __name__ == "__main__":
    unittest.main()
