import runpy
import unittest
from pathlib import Path

MODULE = runpy.run_path(
    str(Path(__file__).parents[1] / "inspect-fuvest-font-glyphs.py"),
    run_name="inspect_fuvest_font_glyphs_test",
)


class FuvestFontGlyphInspectorTest(unittest.TestCase):
    def test_parses_bfchar_sources_for_suspicious_unicode(self):
        cmap = b"""
        2 beginbfchar
        <01> <0001>
        <02> <F0B7>
        endbfchar
        """
        parsed = MODULE["parse_tounicode_sources"](cmap)
        self.assertEqual(parsed["\x01"], ["01"])
        self.assertEqual(parsed["\uf0b7"], ["02"])

    def test_parses_simple_bfrange(self):
        cmap = b"""
        1 beginbfrange
        <10> <12> <F0B4>
        endbfrange
        """
        parsed = MODULE["parse_tounicode_sources"](cmap)
        self.assertEqual(parsed["\uf0b4"], ["10"])
        self.assertEqual(parsed["\uf0b5"], ["11"])
        self.assertEqual(parsed["\uf0b6"], ["12"])

    def test_ignores_normal_text_and_soft_hyphen(self):
        self.assertFalse(MODULE["is_suspicious"]("A"))
        self.assertFalse(MODULE["is_suspicious"]("\u00ad"))
        self.assertTrue(MODULE["is_suspicious"]("\x01"))
        self.assertTrue(MODULE["is_suspicious"]("\ue000"))


if __name__ == "__main__":
    unittest.main()
