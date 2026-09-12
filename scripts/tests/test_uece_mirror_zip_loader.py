from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


ingest = load("ingest_uece_mirror_zip_loader", "ingest-uece-mirror.py")


class UeceMirrorZipLoaderTests(unittest.TestCase):
    def test_zip_loader_uses_generic_inbox_without_legacy_extract_pdf_text(self) -> None:
        self.assertFalse(hasattr(ingest.core.base, "extract_pdf_text"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("nested/prova.pdf", b"%PDF-1.4\nsynthetic")
            documents = ingest.load_documents(path)
        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0].leaf, "prova.pdf")
        self.assertTrue(documents[0].bytes.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
