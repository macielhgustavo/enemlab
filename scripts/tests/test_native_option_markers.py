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
    def __init__(
        self,
        blocks,
        width=600.0,
        height=840.0,
        *,
        drawings=None,
        image_rects=None,
    ):
        self.blocks = blocks
        self.rect = SimpleNamespace(width=width, height=height)
        self.drawings = drawings or []
        self.image_rects = image_rects or {}

    def get_text(self, kind, sort=True):
        if kind != "dict":
            raise AssertionError(kind)
        return {"blocks": self.blocks}

    def get_drawings(self):
        return self.drawings

    def get_images(self, full=True):
        return [(xref,) for xref in self.image_rects]

    def get_image_rects(self, xref):
        return [
            SimpleNamespace(x0=x0, y0=y0, x1=x1, y1=y1)
            for x0, y0, x1, y1 in self.image_rects.get(xref, [])
        ]


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


def point(x, y):
    return SimpleNamespace(x=x, y=y)


def header_drawing(top, *, divider=384.0, width=600.0):
    bottom = top + 18.0
    return {
        "items": [
            ("l", point(30.0, top), point(width - 30.0, top)),
            ("l", point(30.0, bottom), point(width - 30.0, bottom)),
            ("l", point(divider, top), point(divider, bottom)),
        ]
    }


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

    def test_detects_two_horizontal_groups_on_same_visual_row(self):
        first = [line(span(letter, 30 + index * 45, 100)) for index, letter in enumerate("ABCDE")]
        second = [line(span(letter, 330 + index * 45, 100)) for index, letter in enumerate("ABCDE")]
        doc = [FakePage([block([*first, *second], (30, 100, 530, 112))])]

        groups = markers.detect_ordered_option_groups(doc, tuple("ABCDE"), 2)

        self.assertEqual(len(groups), 2)
        self.assertEqual([group.kind for group in groups], ["horizontal", "horizontal"])
        self.assertLess(groups[0].x1, groups[1].x0)

    def test_detects_wrapped_option_grids_after_stronger_detectors(self):
        abc_de = block(
            [
                line(span("A", 36, 100)),
                line(span("B", 204, 100)),
                line(span("C", 355, 100)),
                line(span("D", 36, 170)),
                line(span("E", 204, 170)),
            ],
            (36, 100, 365, 182),
        )
        ab_cd_e = block(
            [
                line(span("A", 36, 300)),
                line(span("B", 288, 300)),
                line(span("C", 36, 350)),
                line(span("D", 288, 350)),
                line(span("E", 36, 400)),
            ],
            (36, 300, 298, 412),
        )
        doc = [FakePage([abc_de, ab_cd_e])]

        groups = markers.detect_ordered_option_groups(doc, tuple("ABCDE"), 2)

        self.assertEqual(len(groups), 2)
        self.assertEqual([group.kind for group in groups], ["wrapped", "wrapped"])

    def test_wrapped_detector_rejects_letters_spread_across_page(self):
        labels = [
            markers.OptionLabel(0, index, letter, 36, 100 + index * 120, 46, 112 + index * 120, "Body", 12.0)
            for index, letter in enumerate("ABCDE")
        ]

        groups = markers._wrapped_groups(labels, tuple("ABCDE"), set())

        self.assertEqual(groups, [])

    def test_block_fallback_preserves_side_by_side_groups(self):
        blocks = [
            {"page_index": 0, "letters": list("ABCDE"), "bbox": (30.0, 100.0, 250.0, 220.0)},
            {"page_index": 0, "letters": list("ABCDE"), "bbox": (330.0, 100.0, 560.0, 220.0)},
        ]

        groups = markers._block_fallback_groups(blocks, [], tuple("ABCDE"))

        self.assertEqual(len(groups), 2)
        self.assertLess(groups[0].x1, groups[1].x0)

    def test_recovers_vertical_options_split_across_text_blocks(self):
        blocks = [
            block(
                [line(span(f"{letter}) option", 60, 100 + index * 28))],
                (60, 100 + index * 28, 500, 122 + index * 28),
            )
            for index, letter in enumerate("ABCDE")
        ]
        groups = markers.detect_ordered_option_groups([FakePage(blocks)], tuple("ABCDE"), 1)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].kind, "vertical")
        self.assertGreater(groups[0].y1, groups[0].y0)

    def test_recovers_horizontal_options_split_across_text_blocks(self):
        blocks = [
            block(
                [line(span(f"{letter}) option", 40 + index * 105, 140))],
                (40 + index * 105, 140, 130 + index * 105, 162),
            )
            for index, letter in enumerate("ABCDE")
        ]
        groups = markers.detect_ordered_option_groups([FakePage(blocks)], tuple("ABCDE"), 1)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].kind, "horizontal")

    def test_ordered_line_partition_accepts_noncanonical_visual_order(self):
        labels = []
        y = 100.0
        for letters in ("ABCDE", "ACEBD", "ABCDE", "DEABC"):
            for letter in letters:
                labels.append(
                    markers.OptionLabel(
                        0, len(labels), letter, 40, y, 500, y + 12, "Body", 12.0, y + 18
                    )
                )
                y += 18

        groups = markers._partition_ordered_line_groups(labels, tuple("ABCDE"), 4)

        self.assertEqual(len(groups), 4)
        self.assertTrue(all(group.kind == "ordered-lines" for group in groups))

    def test_ordered_line_partition_accepts_unique_rare_style_surplus(self):
        labels = []
        for letter in "ABCDE":
            labels.append(
                markers.OptionLabel(
                    0, len(labels), letter, 40, 100 + len(labels) * 10,
                    500, 112 + len(labels) * 10, "Body", 12.0
                )
            )
        labels.append(
            markers.OptionLabel(
                0, len(labels), "A", 500, 220, 510, 232, "Noise", 8.0
            )
        )
        for letters in ("ABCDE", "ABCDE"):
            for letter in letters:
                labels.append(
                    markers.OptionLabel(
                        0, len(labels), letter, 40, 250 + len(labels) * 10,
                        500, 262 + len(labels) * 10, "Body", 12.0
                    )
                )

        groups = markers._partition_ordered_line_groups(labels, tuple("ABCDE"), 3)

        self.assertEqual(len(groups), 3)

    def test_ordered_line_partition_fails_closed_on_ambiguous_surplus(self):
        labels = []
        for page, letters in enumerate(("ABCDE", "AABCDE", "ABCDE")):
            for letter in letters:
                index = len(labels)
                labels.append(
                    markers.OptionLabel(
                        page, index, letter, 40, 100 + index, 500, 112 + index, "Body", 12.0
                    )
                )

        groups = markers._partition_ordered_line_groups(labels, tuple("ABCDE"), 3)

        self.assertEqual(groups, [])

    def test_near_complete_line_partition_uses_geometric_supplements(self):
        punctuated_blocks = []
        for group_index, letters in enumerate(("ABCDE", "ACEBD", "ABCDE")):
            lines = [
                line(span(f"{letter}) option", 60, 80 + group_index * 130 + row * 18))
                for row, letter in enumerate(letters)
            ]
            punctuated_blocks.append(
                block(lines, (60, 80 + group_index * 130, 500, 175 + group_index * 130))
            )

        isolated_one = block(
            [
                line(span(letter, 40, 500 + row * 18, font="Option"))
                for row, letter in enumerate("ABCDE")
            ],
            (40, 500, 180, 585),
        )
        isolated_two = block(
            [
                line(span(letter, 40, 650 + row * 18, font="Option"))
                for row, letter in enumerate("ABCDE")
            ],
            (40, 650, 180, 735),
        )

        groups = markers.detect_ordered_option_groups(
            [FakePage([*punctuated_blocks, isolated_one, isolated_two])],
            tuple("ABCDE"),
            5,
        )

        self.assertEqual(len(groups), 5)
        self.assertEqual(sum(group.kind == "ordered-lines" for group in groups), 3)

    def test_raster_header_fallback_recovers_exactly_one_missing_group(self):
        punctuated_blocks = []
        for base_y in (80.0, 230.0, 550.0):
            lines = [
                line(span(f"{letter}) option", 60, base_y + row * 14))
                for row, letter in enumerate("ABCDE")
            ]
            punctuated_blocks.append(block(lines, (60, base_y, 500, base_y + 72)))

        drawings = [
            header_drawing(50.0),
            header_drawing(200.0),
            header_drawing(350.0),
            header_drawing(500.0),
            header_drawing(650.0, divider=360.0),
            header_drawing(720.0, divider=360.0),
        ]
        page = FakePage(
            punctuated_blocks,
            drawings=drawings,
            image_rects={1: [(100.0, 390.0, 500.0, 450.0)]},
        )

        groups = markers.detect_ordered_option_groups([page], tuple("ABCDE"), 4)

        self.assertEqual(len(groups), 4)
        self.assertEqual([group.kind for group in groups], [
            "ordered-lines",
            "ordered-lines",
            "raster-header-image",
            "ordered-lines",
        ])
        self.assertGreater(groups[2].core_y1, groups[2].y0)
        self.assertGreater(groups[2].y1, groups[2].core_y1)

    def test_raster_header_fallback_fails_closed_without_significant_image(self):
        punctuated_blocks = []
        for base_y in (80.0, 230.0, 550.0):
            lines = [
                line(span(f"{letter}) option", 60, base_y + row * 14))
                for row, letter in enumerate("ABCDE")
            ]
            punctuated_blocks.append(block(lines, (60, base_y, 500, base_y + 72)))

        page = FakePage(
            punctuated_blocks,
            drawings=[
                header_drawing(50.0),
                header_drawing(200.0),
                header_drawing(350.0),
                header_drawing(500.0),
            ],
        )

        with self.assertRaises(markers.OrderedOptionMarkerError):
            markers.detect_ordered_option_groups([page], tuple("ABCDE"), 4)

    def test_ordered_line_group_extends_to_containing_block_tail(self):
        option_block = block(
            [
                line(span(f"{letter}) option", 60, 100 + row * 25))
                for row, letter in enumerate("ABCDE")
            ],
            (60, 100, 500, 260),
        )
        labels = markers._collect_line_option_labels([FakePage([option_block])])
        group = markers._ordered_line_group(labels, tuple("ABCDE"))

        self.assertIsNotNone(group)
        self.assertAlmostEqual(group.y1, 260.0)

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
            [
                line(span(letter, 250, 350 + index * 10, font="Math", size=9.0))
                for index, letter in enumerate("ABCDE")
            ],
            (250, 350, 280, 410),
        )
        fallback = block(
            [
                line(span(f"{letter}) option", 60, 430 + index * 20, font="Option"))
                for index, letter in enumerate("ABCDE")
            ],
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
