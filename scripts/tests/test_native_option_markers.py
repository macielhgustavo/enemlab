from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPTS = Path(__file__).parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import native_option_markers as markers


class FakePage:
    def __init__(self, blocks, width=600.0, height=840.0):
        self.blocks = blocks
        self.rect = SimpleNamespace(width=width, height=height)

    def get_text(self, kind, sort=True):
        if kind != "dict":
            raise AssertionError(kind)
        return {"blocks": self.blocks}


def span(text, x0, y0, *, font="Body", size=12.0):
    return {
        "text": text,
        "bbox": (x0, y0, x0 + 10, y0 + 12),
        "font": font,
        "size": size,
    }


def line(*spans):
    return {"spans": list(spans)}


def block(lines, bbox):
    return {"lines": lines, "bbox": bbox}


class OrderedOptionMarkerTests(unittest.TestCase):
    def test_detects_horizontal_vertical_and_block_fallback(self):
        horizontal = block(
            [
                line(span(letter, 80 + index * 90, 100))
                for index, letter in enumerate("ABCDE")
            ],
            (80, 100, 470, 112),
        )
        vertical = block(
            [
                line(span(letter, 40, 220 + index * 24))
                for index, letter in enumerate("ABCDE")
            ],
            (40, 220, 120, 330),
        )
        fallback = block(
            [
                line(span(f"{letter}) option", 60, 430 + index * 20))
                for index, letter in enumerate("ABCDE")
            ],
            (60, 430, 500, 530),
        )
        doc = [FakePage([horizontal, vertical, fallback])]

        groups = markers.detect_ordered_option_groups(doc, tuple("ABCDE"), 3)
        self.assertEqual([group.kind for group in groups], ["horizontal", "vertical", "block"])

    def test_ignores_formula_letters_in_minor_style(self):
        horizontal = block(
            [
                line(span(letter, 80 + index * 90, 100, font="Option"))
                for index, letter in enumerate("ABCDE")
            ],
            (80, 100, 470, 112),
        )
        vertical = block(
            [
                line(span(letter, 40, 220 + index * 24, font="Option"))
                for index, letter in enumerate("ABCDE")
            ],
            (40, 220, 120, 330),
        )
        noise = block(
            [line(span(letter, 250, 350 + index * 10, font="Math", size=9.0)) for index, letter in enumerate("ABCDE")],
            (250, 350, 280, 410),
        )
        fallback = block(
            [line(span(f"{letter}) option", 60, 430 + index * 20, font="Option")) for index, letter in enumerate("ABCDE")],
            (60, 430, 500, 530),
        )
        groups = markers.detect_ordered_option_groups(
            [FakePage([horizontal, vertical, noise, fallback])], tuple("ABCDE"), 3
        )
        self.assertEqual(len(groups), 3)

    def test_fails_closed_when_group_count_diverges(self):
        horizontal = block(
            [line(span(letter, 80 + index * 90, 100)) for index, letter in enumerate("ABCDE")],
            (80, 100, 470, 112),
        )
        vertical = block(
            [line(span(letter, 40, 220 + index * 24)) for index, letter in enumerate("ABCDE")],
            (40, 220, 120, 330),
        )
        with self.assertRaises(markers.OrderedOptionMarkerError):
            markers.detect_ordered_option_groups([FakePage([horizontal, vertical])], tuple("ABCDE"), 3)

    def test_markers_split_same_page_after_previous_options(self):
        page = FakePage([])
        groups = [
            markers.OptionGroup(0, "horizontal", 80, 100, 470, 112),
            markers.OptionGroup(0, "vertical", 40, 300, 100, 420),
        ]
        made = markers.markers_from_groups(
            [page],
            groups,
            lambda **values: SimpleNamespace(**values),
        )
        self.assertEqual([marker.number for marker in made], [1, 2])
        self.assertAlmostEqual(made[0].y0, 840 * 0.03)
        self.assertGreater(made[1].y0, groups[0].y1)
        self.assertLess(made[1].y0, groups[1].y0)

    def test_page_transition_adds_only_meaningful_tail(self):
        groups = [
            markers.OptionGroup(0, "vertical", 40, 300, 100, 500),
            markers.OptionGroup(1, "vertical", 40, 300, 100, 500),
        ]
        regions = markers.preceding_page_regions([FakePage([]), FakePage([])], groups)
        self.assertIn(2, regions)
        self.assertEqual(regions[2][0][0], 0)


if __name__ == "__main__":
    unittest.main()
