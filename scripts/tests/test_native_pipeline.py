import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "native_pipeline",
    Path(__file__).parents[1] / "native_pipeline.py",
)
native = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = native
assert SPEC.loader is not None
SPEC.loader.exec_module(native)


class NativePipelineTests(unittest.TestCase):
    def test_marker_gate_requires_exact_coverage(self):
        markers = [
            native.Marker(number=1, page_index=0, x0=1, y0=1, x1=2, y1=2),
            native.Marker(number=2, page_index=0, x0=1, y0=3, x1=2, y1=4),
        ]
        native.validate_marker_numbers(markers, 2)
        with self.assertRaisesRegex(native.NativePipelineError, "faltantes"):
            native.validate_marker_numbers(markers[:1], 2)

    def test_semantic_option_detection_is_not_authoritative(self):
        text = "(A) um (B) dois (C) três (D) quatro (E) cinco"
        self.assertEqual(
            native._detected_options(text, ("A", "B", "C", "D", "E")),
            ["A", "B", "C", "D", "E"],
        )
        self.assertEqual(native._detected_options("sem alternativas", ("A", "B")), [])

    def test_detects_shared_question_ranges_with_accents_and_variants(self):
        self.assertEqual(
            native._shared_question_range(
                "Para responder às questões de 01 a 05, leia o romance ilustrado."
            ),
            (1, 5),
        )
        self.assertEqual(
            native._shared_question_range("Use o texto para responder às questões 07 até 11."),
            (7, 11),
        )
        self.assertEqual(native._shared_question_range("Questão 12"), None)

    def test_detects_visual_and_context_dependencies(self):
        reasons = native._visual_dependency_reasons(
            "Depreende-se do romance ilustrado e da tirinha que o gráfico apresentado..."
        )
        self.assertIn("context:romance", reasons)
        self.assertIn("media:image", reasons)
        self.assertIn("media:chart", reasons)

    def test_layout_spans_columns_when_right_question_starts_much_lower(self):
        q6 = native.Marker(number=6, page_index=0, x0=40, y0=50, x1=200, y1=70)
        q7 = native.Marker(number=7, page_index=0, x0=330, y0=310, x1=500, y1=330)
        self.assertTrue(native._should_span_columns(q6, [q6, q7], 600, 800))

    def test_layout_keeps_parallel_questions_in_separate_columns(self):
        q1 = native.Marker(number=1, page_index=0, x0=40, y0=100, x1=200, y1=120)
        q3 = native.Marker(number=3, page_index=0, x0=330, y0=108, x1=500, y1=128)
        q2 = native.Marker(number=2, page_index=0, x0=40, y0=390, x1=200, y1=410)
        self.assertFalse(native._should_span_columns(q1, [q1, q2, q3], 600, 800))

    def test_spec_rejects_non_single_answer_alphabet(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spec.json"
            path.write_text(
                '{"providerId":"x","year":2026,"phase":"single","total":1,'
                '"optionIds":["A","F"],"sourceSha256":"' + "a" * 64 + '",'
                '"sourceUrl":"https://example.test/prova.pdf",'
                '"questionKeyFormat":"x-2026-single-{number}"}',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(native.NativePipelineError, "A-E"):
                native._load_spec(path)

    def test_spec_requires_audited_question_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "spec.json"
            path.write_text(
                '{"providerId":"x","year":2026,"phase":"single","total":1,'
                '"optionIds":["A","B"],"sourceSha256":"' + "a" * 64 + '",'
                '"sourceUrl":"https://example.test/prova.pdf"}',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(native.NativePipelineError, "questionKeyFormat"):
                native._load_spec(path)

    def test_question_key_uses_provider_audited_format(self):
        spec = native.Spec(
            provider_id="eear",
            year=2025,
            phase="single",
            edition_id="2025-cfs-1-opcao-02",
            total=96,
            option_ids=("A", "B", "C", "D"),
            source_sha256="a" * 64,
            source_url="https://example.test/prova.pdf",
            question_key_format="eear-2025-cfs-1-opcao-02-single-{number}",
        )
        self.assertEqual(
            native._question_key(spec, 1),
            "eear-2025-cfs-1-opcao-02-single-1",
        )


if __name__ == "__main__":
    unittest.main()
