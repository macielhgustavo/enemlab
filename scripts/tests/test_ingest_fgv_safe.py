import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "ingest-fgv-safe.py"
spec = importlib.util.spec_from_file_location("ingest_fgv_safe_tested", SCRIPT)
assert spec and spec.loader
fgv = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = fgv
spec.loader.exec_module(fgv)


class FgvExtractorTests(unittest.TestCase):
    def test_normalizes_answer_marked_pair_names(self):
        self.assertEqual(
            fgv.normalized_stem("Gabaritos/CG-EAESP-Objetivo-Bloco1-GABARITO.pdf"),
            fgv.normalized_stem("Provas/CG-EAESP-Objetivo-Bloco1.pdf"),
        )
        self.assertEqual(
            fgv.normalized_stem("G-UNIFICADO-Objetivo-Bloco3-ingles-portugues.pdf"),
            fgv.normalized_stem("UNIFICADO-Objetivo-Bloco3-ingles-portugues_0.pdf"),
        )

    def test_rejects_discursive_and_redaction_members(self):
        self.assertFalse(fgv.is_objective_member("UNIFICADO-Discursivo-Bloco2.pdf"))
        self.assertFalse(fgv.is_objective_member("Redacao-EAESP.pdf"))
        self.assertTrue(fgv.is_objective_member("CG-EAESP-Objetivo-Bloco1.pdf"))

    def test_choice_groups_require_local_five_bullet_sequence(self):
        runs = []
        for i, glyph in enumerate([fgv.OPEN_GLYPH, fgv.OPEN_GLYPH, fgv.SELECTED_GLYPH, fgv.OPEN_GLYPH, fgv.OPEN_GLYPH]):
            runs.append(fgv.Run(glyph, "/ABC+Wingdings", 11.0, 42.5, 700 - i * 20, 1))
            runs.append(fgv.Run(f"alt-{i}", "/ABC+Text", 11.0, 56.0, 700 - i * 20, 1))
        groups = fgv.choice_groups(runs)
        self.assertEqual(groups, [[0, 2, 4, 6, 8]])
        selected = [i for i, index in enumerate(groups[0]) if runs[index].text == fgv.SELECTED_GLYPH]
        self.assertEqual(selected, [2])

    def test_programs_stay_separate(self):
        self.assertEqual(fgv.program("Provas e Gabaritos FGV Administração 2020/2 (EAESP)"), "Administração EAESP")
        self.assertEqual(fgv.program("Provas e Gabaritos FGV-Rio 2021"), "Unificado Rio")
        self.assertEqual(fgv.program("Provas e Gabaritos Economia FGV 2021"), "Economia")


if __name__ == "__main__":
    unittest.main()
