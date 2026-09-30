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

    def test_line_question_parser_accepts_right_column_anchor(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        rows = [
            "5\t1\t1\t1\t1\t1\t1100\t240\t24\t24\t92\t17\n",
            "5\t1\t1\t1\t1\t2\t1140\t240\t180\t24\t91\tConsidere\n",
        ]
        markers = ocr.line_question_markers_from_tsv(
            header + "".join(rows),
            page_index=0,
            scale=2.0,
            page_width=800.0,
            page_height=700.0,
            total=48,
            marker_factory=lambda **kwargs: kwargs,
            x_ranges=((0.0, 0.30), (0.45, 0.82)),
        )
        self.assertEqual([item["number"] for item in markers], [17])

    def test_line_question_parser_ignores_numeric_token_inside_sentence(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        rows = [
            "5\t1\t1\t1\t1\t1\t100\t240\t120\t24\t92\tCalcule\n",
            "5\t1\t1\t1\t1\t2\t260\t240\t24\t24\t92\t17\n",
        ]
        markers = ocr.line_question_markers_from_tsv(
            header + "".join(rows),
            page_index=0,
            scale=2.0,
            page_width=800.0,
            page_height=700.0,
            total=48,
            marker_factory=lambda **kwargs: kwargs,
            x_ranges=((0.0, 0.30), (0.45, 0.82)),
        )
        self.assertEqual(markers, [])

    def test_line_question_parser_accepts_explicit_questao_prefix(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        rows = [
            "5\t1\t1\t1\t1\t1\t760\t240\t120\t24\t90\tQUESTÃO\n",
            "5\t1\t1\t1\t1\t2\t900\t240\t24\t24\t90\t09\n",
        ]
        markers = ocr.line_question_markers_from_tsv(
            header + "".join(rows),
            page_index=0,
            scale=2.0,
            page_width=800.0,
            page_height=700.0,
            total=48,
            marker_factory=lambda **kwargs: kwargs,
            x_ranges=((0.0, 0.30), (0.45, 0.82)),
        )
        self.assertEqual([item["number"] for item in markers], [9])

    def test_line_question_parser_repairs_digit_like_ocr_only_when_enabled(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        row = "5\t1\t1\t1\t1\t1\t1100\t240\t28\t24\t91\t4T\n"
        common = dict(
            page_index=0,
            scale=2.0,
            page_width=800.0,
            page_height=700.0,
            total=48,
            marker_factory=lambda **kwargs: kwargs,
            x_ranges=((0.0, 0.30), (0.45, 0.82)),
        )
        strict = ocr.line_question_markers_from_tsv(header + row, **common)
        repaired = ocr.line_question_markers_from_tsv(
            header + row,
            allow_digit_confusions=True,
            **common,
        )
        self.assertEqual(strict, [])
        self.assertEqual([item["number"] for item in repaired], [47])

    def test_digit_confusion_never_turns_pure_letters_into_question_number(self):
        self.assertIsNone(
            ocr._ocr_number_value("BT", 48, allow_digit_confusions=True)
        )

    def test_pure_digit_confusion_requires_expected_localized_number(self):
        self.assertIsNone(
            ocr._ocr_number_value(
                "B",
                48,
                allow_digit_confusions=True,
                allow_pure_digit_confusions=True,
            )
        )
        self.assertEqual(
            ocr._ocr_number_value(
                "B",
                48,
                allow_digit_confusions=True,
                expected_numbers={8},
                allow_pure_digit_confusions=True,
            ),
            8,
        )
        self.assertIsNone(
            ocr._ocr_number_value(
                "B",
                48,
                allow_digit_confusions=True,
                expected_numbers={7},
                allow_pure_digit_confusions=True,
            )
        )

    def test_dominant_question_rail_keeps_proven_rail_and_marks_missing(self):
        marker = SimpleNamespace
        page_widths = {page: 600.0 for page in range(8)}
        real = [
            marker(number=n, page_index=(n - 1) // 2, x0=110.0, y0=80.0 + (n % 2) * 180, x1=120.0, y1=95.0 + (n % 2) * 180)
            for n in range(1, 13)
            if n != 8
        ]
        noise = [
            marker(number=n, page_index=min(7, n // 2), x0=330.0, y0=300.0, x1=340.0, y1=315.0)
            for n in range(2, 9)
        ]
        selected, center = ocr.select_dominant_question_rail(
            [*real, *noise],
            24,
            page_widths,
        )
        self.assertIsNotNone(center)
        self.assertNotIn(8, {item.number for item in selected})
        for n in range(2, 8):
            self.assertTrue(
                all(abs(item.x0 - 110.0) < 1 for item in selected if item.number == n)
            )

    def test_dominant_question_rail_refuses_ambiguous_equal_rails(self):
        marker = SimpleNamespace
        page_widths = {page: 600.0 for page in range(8)}
        left = [
            marker(number=n, page_index=(n - 1) // 2, x0=110.0, y0=100.0, x1=120.0, y1=115.0)
            for n in range(1, 9)
        ]
        right = [
            marker(number=n, page_index=(n - 1) // 2, x0=410.0, y0=300.0, x1=420.0, y1=315.0)
            for n in range(1, 9)
        ]
        selected, center = ocr.select_dominant_question_rail(
            [*left, *right],
            24,
            page_widths,
        )
        self.assertIsNone(center)
        self.assertEqual(len(selected), 16)

    def test_recovery_must_stay_between_known_neighbors(self):
        marker = SimpleNamespace
        page_widths = {0: 600.0, 1: 600.0, 2: 600.0}
        known = [
            marker(number=7, page_index=0, x0=110, y0=600, x1=120, y1=615),
            marker(number=9, page_index=1, x0=110, y0=220, x1=120, y1=235),
        ]
        recovered = [
            marker(number=8, page_index=1, x0=110, y0=100, x1=120, y1=115),
            marker(number=8, page_index=2, x0=110, y0=100, x1=120, y1=115),
        ]
        accepted = ocr.filter_recovery_between_known_neighbors(
            recovered,
            known,
            page_widths,
        )
        self.assertEqual(
            [(item.number, item.page_index) for item in accepted],
            [(8, 1)],
        )

    def test_monotonic_sequence_resolves_unique_path_across_columns(self):
        marker = SimpleNamespace
        candidates = [
            marker(number=1, page_index=0, x0=40, y0=100, x1=50, y1=112),
            marker(number=1, page_index=4, x0=40, y0=100, x1=50, y1=112),
            marker(number=2, page_index=0, x0=40, y0=200, x1=50, y1=212),
            marker(number=2, page_index=4, x0=40, y0=200, x1=50, y1=212),
            marker(number=3, page_index=0, x0=420, y0=100, x1=430, y1=112),
        ]
        resolved = ocr.unique_monotonic_marker_sequence(
            candidates,
            3,
            {0: 800.0, 4: 800.0},
        )
        self.assertIsNotNone(resolved)
        self.assertEqual(
            [(item.number, item.page_index, item.x0) for item in resolved],
            [(1, 0, 40), (2, 0, 40), (3, 0, 420)],
        )

    def test_monotonic_sequence_rejects_two_complete_paths(self):
        marker = SimpleNamespace
        candidates = [
            marker(number=1, page_index=0, x0=40, y0=100, x1=50, y1=112),
            marker(number=1, page_index=2, x0=40, y0=100, x1=50, y1=112),
            marker(number=2, page_index=0, x0=40, y0=200, x1=50, y1=212),
            marker(number=2, page_index=2, x0=40, y0=200, x1=50, y1=212),
        ]
        self.assertIsNone(
            ocr.unique_monotonic_marker_sequence(
                candidates,
                2,
                {0: 800.0, 2: 800.0},
            )
        )

    def test_monotonic_sequence_rejects_missing_number(self):
        marker = SimpleNamespace
        candidates = [
            marker(number=1, page_index=0, x0=40, y0=100, x1=50, y1=112),
            marker(number=3, page_index=0, x0=40, y0=300, x1=50, y1=312),
        ]
        self.assertIsNone(
            ocr.unique_monotonic_marker_sequence(
                candidates,
                3,
                {0: 800.0},
            )
        )

    def test_monotonic_sequence_dedupes_same_geometry_across_ocr_passes(self):
        marker = SimpleNamespace
        candidates = [
            marker(number=1, page_index=0, x0=40, y0=100, x1=50, y1=112),
            marker(number=1, page_index=0, x0=42, y0=102, x1=52, y1=114),
            marker(number=2, page_index=0, x0=40, y0=200, x1=50, y1=212),
        ]
        resolved = ocr.unique_monotonic_marker_sequence(
            candidates,
            2,
            {0: 800.0},
        )
        self.assertIsNotNone(resolved)
        self.assertEqual([item.number for item in resolved], [1, 2])

    def test_neighbor_recovery_pages_stays_between_adjacent_markers(self):
        marker = SimpleNamespace
        markers = [
            marker(number=46, page_index=8, x0=40, y0=100, x1=50, y1=112),
            marker(number=48, page_index=9, x0=40, y0=300, x1=50, y1=312),
            # Ruído distante não pode ampliar a recuperação localizada.
            marker(number=46, page_index=2, x0=40, y0=100, x1=50, y1=112),
            marker(number=48, page_index=12, x0=40, y0=300, x1=50, y1=312),
        ]
        self.assertEqual(
            ocr._neighbor_recovery_pages(markers, {47}, 48),
            {8, 9},
        )

    def test_neighbor_recovery_pages_returns_empty_without_structural_neighbors(self):
        marker = SimpleNamespace
        markers = [
            marker(number=10, page_index=1, x0=40, y0=100, x1=50, y1=112),
        ]
        self.assertEqual(
            ocr._neighbor_recovery_pages(markers, {47}, 48),
            set(),
        )

    def test_structural_noise_suppression_removes_footer_page_numbers(self):
        marker = SimpleNamespace
        page_widths = {0: 600.0}
        page_heights = {0: 840.0}
        items = [
            marker(number=2, page_index=0, x0=110.0, y0=320.0, x1=120.0, y1=335.0),
            marker(number=2, page_index=0, x0=295.0, y0=800.0, x1=305.0, y1=815.0),
        ]
        cleaned = ocr.suppress_structural_number_noise(items, page_widths, page_heights)
        self.assertEqual([(item.number, item.x0) for item in cleaned], [(2, 110.0)])

    def test_structural_noise_suppression_removes_dense_index_when_real_candidates_exist(self):
        marker = SimpleNamespace
        page_widths = {0: 600.0, 1: 600.0, 2: 600.0}
        page_heights = {0: 840.0, 1: 840.0, 2: 840.0}
        index = [
            marker(number=n, page_index=0, x0=58.0, y0=300.0 + n * 20, x1=68.0, y1=315.0 + n * 20)
            for n in range(1, 8)
        ]
        real = [
            marker(number=n, page_index=1 if n <= 4 else 2, x0=110.0, y0=80.0 + (n % 4) * 120, x1=120.0, y1=95.0 + (n % 4) * 120)
            for n in range(1, 8)
        ]
        cleaned = ocr.suppress_structural_number_noise(
            [*index, *real],
            page_widths,
            page_heights,
        )
        positions = {(item.number, item.page_index, item.x0) for item in cleaned}
        # O Q1 mais cedo pode ser legítimo; Q2..Q7 do índice são ruído provado.
        self.assertIn((1, 0, 58.0), positions)
        for n in range(2, 8):
            self.assertNotIn((n, 0, 58.0), positions)
            self.assertTrue(any(item.number == n and item.page_index > 0 for item in cleaned))

    def test_structural_noise_suppression_keeps_small_real_question_group(self):
        marker = SimpleNamespace
        page_widths = {0: 600.0}
        page_heights = {0: 840.0}
        items = [
            marker(number=n, page_index=0, x0=110.0, y0=100.0 + n * 140, x1=120.0, y1=115.0 + n * 140)
            for n in range(1, 4)
        ]
        cleaned = ocr.suppress_structural_number_noise(items, page_widths, page_heights)
        self.assertEqual([item.number for item in cleaned], [1, 2, 3])

    def test_structural_noise_suppression_keeps_spaced_consecutive_question_rail(self):
        marker = SimpleNamespace
        page_widths = {0: 600.0, 1: 600.0}
        page_heights = {0: 840.0, 1: 840.0}
        # Cinco questões consecutivas no mesmo x, mas espaçadas como conteúdo
        # real. Uma sequência numérica isolada não pode ser tratada como índice.
        real = [
            marker(number=n, page_index=0, x0=110.0, y0=80.0 + (n - 9) * 75.0, x1=120.0, y1=95.0 + (n - 9) * 75.0)
            for n in range(9, 14)
        ]
        # Candidatos espúrios em outra página não devem fazer o rail real sumir.
        alternates = [
            marker(number=n, page_index=1, x0=300.0, y0=790.0, x1=310.0, y1=805.0)
            for n in range(9, 14)
        ]
        cleaned = ocr.suppress_structural_number_noise(
            [*real, *alternates],
            page_widths,
            page_heights,
        )
        kept = {(item.number, item.page_index) for item in cleaned}
        for n in range(9, 14):
            self.assertIn((n, 0), kept)

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
