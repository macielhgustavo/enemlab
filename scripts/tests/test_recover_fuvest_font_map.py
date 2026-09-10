import runpy
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "recover-fuvest-font-map.py"),
    run_name="recover_fuvest_font_map_test",
)


class FuvestProofFontMapTest(unittest.TestCase):
    def test_cid_to_gid_stream_is_big_endian_and_fail_closed(self):
        data = b"\x00\x00\x00\x03\x01\x02"
        self.assertEqual(MODULE["cid_to_gid_from_stream"](data, 1), 3)
        self.assertEqual(MODULE["cid_to_gid_from_stream"](data, 2), 0x0102)
        self.assertIsNone(MODULE["cid_to_gid_from_stream"](data, 3))

    def test_unique_gid_unicode_requires_exactly_one_portable_candidate(self):
        glyphs = [".notdef", "space", "ambiguous"]
        reverse = {
            "space": {" "},
            "ambiguous": {"-", "−"},
        }
        self.assertEqual(MODULE["unique_gid_unicode"](glyphs, reverse, 1), " ")
        self.assertIsNone(MODULE["unique_gid_unicode"](glyphs, reverse, 2))
        self.assertIsNone(MODULE["unique_gid_unicode"](glyphs, reverse, 99))

    def test_blank_advancing_glyph_can_normalize_to_space(self):
        self.assertEqual(MODULE["blank_advance_replacement"](0, 226), " ")
        self.assertEqual(MODULE["blank_advance_replacement"](0, 220.0), " ")

    def test_blank_rule_rejects_outlines_and_non_positive_or_unknown_width(self):
        self.assertIsNone(MODULE["blank_advance_replacement"](1, 226))
        self.assertIsNone(MODULE["blank_advance_replacement"](0, 0))
        self.assertIsNone(MODULE["blank_advance_replacement"](0, -1))
        self.assertIsNone(MODULE["blank_advance_replacement"](0, None))

    def test_portable_replacement_rejects_control_private_and_replacement_chars(self):
        self.assertTrue(MODULE["is_portable_replacement"](" "))
        self.assertTrue(MODULE["is_portable_replacement"]("²"))
        self.assertFalse(MODULE["is_portable_replacement"]("\x03"))
        self.assertFalse(MODULE["is_portable_replacement"]("\ue000"))
        self.assertFalse(MODULE["is_portable_replacement"]("\ufffd"))

    def test_suspicious_detector_does_not_flag_normal_newlines_or_soft_hyphen(self):
        self.assertFalse(MODULE["is_suspicious"]("A"))
        self.assertFalse(MODULE["is_suspicious"]("\n"))
        self.assertFalse(MODULE["is_suspicious"]("\u00ad"))
        self.assertTrue(MODULE["is_suspicious"]("\x03"))
        self.assertTrue(MODULE["is_suspicious"]("\ue000"))


if __name__ == "__main__":
    unittest.main()
