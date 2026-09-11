from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ingest_uece_phase_guard", SCRIPTS / "ingest-uece-safe.py")
assert spec and spec.loader
guard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = guard
spec.loader.exec_module(guard)


class Source:
    def __init__(self, title: str, name: str) -> None:
        self.title = title
        self.path = Path(name)


class UecePhaseGuardTests(unittest.TestCase):
    def test_second_phase_title_is_rejected_before_grouping(self) -> None:
        source = Source("Provas e gabaritos UECE 2025 2ª fase", "47717-provas-e-gabaritos-uece-2025-2-fase.zip")
        self.assertEqual(guard.source_phase(source), 2)

    def test_second_day_second_phase_is_rejected(self) -> None:
        source = Source("Prova e gabarito do 2º dia da 2ª fase do Vestibular 2024", "47649-prova-e-gabarito-do-2-dia-da-2-fase-do-vestibular-2024.zip")
        self.assertEqual(guard.source_phase(source), 2)

    def test_first_phase_title_is_preserved(self) -> None:
        source = Source("Provas Uece 1ª fase 2025", "47688-provas-uece-1-fase-2025.zip")
        self.assertEqual(guard.source_phase(source), 1)

    def test_generic_cycle_is_not_dropped(self) -> None:
        source = Source("Provas e gabaritos UECE 2025/2", "47724-provas-e-gabaritos-uece-2025-2.zip")
        self.assertIsNone(guard.source_phase(source))

    def test_first_phase_booklet_named_gabarito_variant_is_exam(self) -> None:
        class Document:
            first_text = (
                "UNIVERSIDADE ESTADUAL DO CEARÁ VESTIBULAR 2025.1 1ª FASE "
                "PROVA DE CONHECIMENTOS GERAIS. Este Caderno de Prova contém "
                "85 (oitenta e cinco) questões, com 4 alternativas cada."
            )
            leaf = "1ª fase prova uece 2025 gabarito 1.pdf"
            page_count = 26
            sha256 = "booklet-variant"

        document = Document()
        self.assertTrue(guard.is_exam(document))
        self.assertFalse(guard.mirror.core.is_key(document))

    def test_short_real_gabarito_stays_out_of_exam_classifier(self) -> None:
        class Document:
            first_text = (
                "GABARITO OFICIAL PRELIMINAR DA PROVA DE CONHECIMENTOS GERAIS "
                "DO VESTIBULAR 2025.1"
            )
            leaf = "gabarito-preliminar-uece-2025-1.pdf"
            page_count = 3
            sha256 = "real-key"

        self.assertFalse(guard.is_exam(Document()))


if __name__ == "__main__":
    unittest.main()
