from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "rank-brasil-escola-national.py"
spec = importlib.util.spec_from_file_location("rank_brasil_escola_national_tested", SCRIPT)
assert spec and spec.loader
ranker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = ranker
spec.loader.exec_module(ranker)


class NationalRankingTests(unittest.TestCase):
    def test_semester_suffix_creates_distinct_edition(self):
        self.assertEqual(ranker.edition_key("Provas UEFS 2018/2", 2018), "2018-2")

    def test_plain_year_is_preserved(self):
        self.assertEqual(ranker.edition_key("Provas e Gabaritos UEMA 2025", 2025), "2025")

    def test_duplicate_entries_do_not_inflate_editions(self):
        institution = {
            "name": "Universidade X",
            "slug": "universidade-x",
            "entries": [
                {"title": "Prova Universidade X 2024", "year": 2024},
                {"title": "Gabarito Universidade X 2024", "year": 2024},
                {"title": "Prova Universidade X 2023", "year": 2023},
            ],
        }
        summary = ranker.summarize_institution("sul", institution)
        self.assertEqual(summary["cataloguedEntries"], 3)
        self.assertEqual(summary["editionSignals"], 2)
        self.assertEqual(summary["distinctYears"], 2)

    def test_ranking_prefers_more_editions(self):
        rows = [
            {"institutionSlug": "b", "editionSignals": 7, "recentEditionSignals": 7, "distinctYears": 7, "cataloguedEntries": 7},
            {"institutionSlug": "a", "editionSignals": 12, "recentEditionSignals": 4, "distinctYears": 10, "cataloguedEntries": 15},
        ]
        self.assertEqual(ranker.rank_rows(rows)[0]["institutionSlug"], "a")


if __name__ == "__main__":
    unittest.main()
