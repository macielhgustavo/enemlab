from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "harvest-brasil-escola.py"
SPEC = importlib.util.spec_from_file_location("harvest_brasil_escola", SCRIPT)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


class BrasilEscolaHarvesterTests(unittest.TestCase):
    def test_parses_northeast_institutions_only(self) -> None:
        html = """
        <a href="/downloads/universidade-estadual-ceara.htm">
          Universidade Estadual do Ceará
        </a>
        <a href="https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-maranhao.htm">
          Universidade Estadual do Maranhão
        </a>
        <a href="/downloads/nordeste.htm">Nordeste</a>
        <a href="https://evil.example/downloads/fake.htm">Fake</a>
        """
        items = module.parse_region_page(
            html,
            "https://vestibular.brasilescola.uol.com.br/downloads/nordeste.htm",
        )
        self.assertEqual(
            [item.slug for item in items],
            ["universidade-estadual-ceara", "universidade-estadual-maranhao"],
        )

    def test_parses_download_id_year_and_count_without_inventing_missing_year(self) -> None:
        institution = module.Institution(
            name="Universidade Estadual do Ceará",
            slug="universidade-estadual-ceara",
            page_url="https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-ceara.htm",
        )
        html = """
        <a href="/baixar/47772">Provas e gabaritos UECE 2026 6.601 downloads realizados</a>
        <a href="/baixar/40000">Arquivo especial sem ano 123 downloads realizados</a>
        <a href="https://evil.example/baixar/1">Não aceitar</a>
        """
        entries = module.parse_institution_page(html, institution)
        self.assertEqual(len(entries), 2)
        by_id = {entry.download_id: entry for entry in entries}
        self.assertEqual(by_id[47772].year, 2026)
        self.assertEqual(by_id[47772].listed_downloads, 6601)
        self.assertEqual(by_id[47772].title, "Provas e gabaritos UECE 2026")
        self.assertIsNone(by_id[40000].year)

    def test_preserves_semester_and_phase_in_raw_title(self) -> None:
        institution = module.Institution(
            name="UECE",
            slug="universidade-estadual-ceara",
            page_url="https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-ceara.htm",
        )
        html = """
        <a href="/baixar/123">Provas e gabaritos UECE 2025/2 7942 downloads realizados</a>
        <a href="/baixar/124">Provas e gabaritos UECE 2025 2ª fase 5483 downloads realizados</a>
        """
        entries = module.parse_institution_page(html, institution)
        titles = {entry.download_id: entry.title for entry in entries}
        self.assertEqual(titles[123], "Provas e gabaritos UECE 2025/2")
        self.assertEqual(titles[124], "Provas e gabaritos UECE 2025 2ª fase")
        self.assertTrue(all(entry.year == 2025 for entry in entries))

    def test_download_validation_requires_real_zip_and_writes_provenance(self) -> None:
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr("prova.pdf", b"%PDF-1.4 fake")
        zip_bytes = payload.getvalue()

        entry = module.CatalogEntry(
            institution="UECE",
            institution_slug="uece",
            institution_page_url="https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-ceara.htm",
            download_id=47772,
            title="Provas e gabaritos UECE 2026",
            year=2026,
            listed_downloads=6601,
            download_url="https://vestibular.brasilescola.uol.com.br/baixar/47772",
        )

        original_fetch = module.fetch_bytes
        module.fetch_bytes = lambda *args, **kwargs: (
            zip_bytes,
            {"content-type": "application/zip", "etag": '"abc"'},
            "https://s5.static.brasilescola.uol.com.br/vestibular/2025/10/provas-e-gabaritos-uece-2026.zip",
        )
        try:
            with tempfile.TemporaryDirectory() as directory:
                downloaded = module.download_entry(
                    entry,
                    download_root=Path(directory),
                    timeout=1,
                    refresh=False,
                )
                self.assertEqual(downloaded.acquisition, "network")
                self.assertEqual(downloaded.sha256, module.sha256_bytes(zip_bytes))
                target = Path(downloaded.local_path)
                self.assertTrue(target.exists())
                metadata = json.loads(
                    target.with_suffix(target.suffix + ".meta.json").read_text(encoding="utf-8")
                )
                self.assertEqual(metadata["providerId"], "brasil-escola")
                self.assertEqual(metadata["rightsStatus"], "third-party-mirror-reference")
                self.assertEqual(metadata["downloadId"], 47772)
                self.assertIn("static.brasilescola.uol.com.br", metadata["resolvedDownloadUrl"])

                cached = module.download_entry(
                    entry,
                    download_root=Path(directory),
                    timeout=1,
                    refresh=False,
                )
                self.assertEqual(cached.acquisition, "cache")
        finally:
            module.fetch_bytes = original_fetch

    def test_rejects_non_zip_download(self) -> None:
        entry = module.CatalogEntry(
            institution="UECE",
            institution_slug="uece",
            institution_page_url="https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-ceara.htm",
            download_id=1,
            title="UECE 2026",
            year=2026,
            listed_downloads=None,
            download_url="https://vestibular.brasilescola.uol.com.br/baixar/1",
        )
        original_fetch = module.fetch_bytes
        module.fetch_bytes = lambda *args, **kwargs: (
            b"<html>nope</html>",
            {"content-type": "text/html"},
            entry.download_url,
        )
        try:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(ValueError, "not a ZIP"):
                    module.download_entry(
                        entry,
                        download_root=Path(directory),
                        timeout=1,
                        refresh=False,
                    )
        finally:
            module.fetch_bytes = original_fetch

    def test_allows_only_brasil_escola_static_cdn_redirects(self) -> None:
        self.assertTrue(
            module.allowed_download_response_url(
                "https://s5.static.brasilescola.uol.com.br/vestibular/2025/10/prova.zip"
            )
        )
        self.assertTrue(
            module.allowed_download_response_url(
                "https://static.brasilescola.uol.com.br/vestibular/prova.zip"
            )
        )
        self.assertFalse(
            module.allowed_download_response_url("https://evil.example/prova.zip")
        )

    def test_selection_filters_do_not_require_contiguous_years(self) -> None:
        entry = module.CatalogEntry(
            institution="UEMA",
            institution_slug="universidade-estadual-maranhao",
            institution_page_url="https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-maranhao.htm",
            download_id=10,
            title="UEMA PAES 2017",
            year=2017,
            listed_downloads=None,
            download_url="https://vestibular.brasilescola.uol.com.br/baixar/10",
        )
        self.assertTrue(module.selection_matches(entry, ["uema", "maranhao"], set()))
        self.assertTrue(module.selection_matches(entry, [], {2017}))
        self.assertFalse(module.selection_matches(entry, [], {2018}))


if __name__ == "__main__":
    unittest.main()
