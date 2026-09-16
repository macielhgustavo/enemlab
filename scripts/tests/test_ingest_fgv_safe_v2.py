import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-fgv-safe-v2.py"
spec = importlib.util.spec_from_file_location("ingest_fgv_safe_v2_tested", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
fgv = mod.fgv


class FgvV2LayoutTests(unittest.TestCase):
    def test_fifth_alternative_stops_at_next_column_jump(self):
        bullet = fgv.Run(fgv.OPEN_GLYPH, "/Wingdings", 11, 42.5, 130.0, 1)
        runs = [
            bullet,
            fgv.Run("last option line", "/Text", 11, 56.6, 117.0, 1),
            fgv.Run("next question statement", "/Text", 11, 329.5, 276.0, 1),
            fgv.Run(fgv.OPEN_GLYPH, "/Wingdings", 11, 329.5, 250.0, 1),
        ]
        self.assertEqual(mod.alternative_end(runs, 1, None, bullet), 2)

    def test_fifth_alternative_stops_at_lower_same_column_statement(self):
        bullet = fgv.Run(fgv.OPEN_GLYPH, "/Wingdings", 11, 42.5, 200.0, 1)
        runs = [
            bullet,
            fgv.Run("last option", "/Text", 11, 56.6, 190.0, 1),
            fgv.Run("wrapped option", "/Text", 11, 56.6, 177.0, 1),
            fgv.Run("next statement", "/Text", 11, 42.5, 150.0, 1),
        ]
        self.assertEqual(mod.alternative_end(runs, 1, None, bullet), 3)

    def test_indented_bullet_margin_still_detects_next_statement(self):
        bullet = fgv.Run(fgv.OPEN_GLYPH, "/Wingdings", 11, 28.3, 336.7, 1)
        runs = [
            bullet,
            fgv.Run("last option", "/Text", 11, 42.5, 336.7, 1),
            fgv.Run("next question statement", "/Text", 11, 42.5, 299.0, 1),
            fgv.Run(fgv.OPEN_GLYPH, "/Wingdings", 11, 42.5, 237.1, 1),
        ]
        self.assertEqual(mod.alternative_end(runs, 1, None, bullet), 2)


if __name__ == "__main__":
    unittest.main()
