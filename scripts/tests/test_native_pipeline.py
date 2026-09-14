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
