from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "permission-required",
      years: [2025],
''',
    '''      rightsStatus: "permission-required",
      years: [2025, 2024],
''',
)

replace_once(
    "docs/exam-sources.md",
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2025 Tipo A |",
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2024–2025 Tipo A |",
)

path = Path("scripts/sources-audit.mjs")
text = path.read_text(encoding="utf-8")
old = '''    documentos: [
      {
        role: "objective-exam",
        url: "https://arquivos.qconcursos.com/prova/arquivo_prova/139039/exercito-2025-essa-sargento-geral-prova.pdf",
      },
      {
        role: "answer-key",
        url: "https://arquivos.qconcursos.com/prova/arquivo_gabarito/139039/exercito-2025-essa-sargento-geral-gabarito.pdf",
      },
    ],
'''
new = '''    documentos: [
      {
        role: "objective-exam",
        url: "https://arquivos.qconcursos.com/prova/arquivo_prova/139039/exercito-2025-essa-sargento-geral-prova.pdf",
      },
      {
        role: "answer-key",
        url: "https://arquivos.qconcursos.com/prova/arquivo_gabarito/139039/exercito-2025-essa-sargento-geral-gabarito.pdf",
      },
      {
        role: "objective-exam",
        url: "https://arquivos.qconcursos.com/prova/arquivo_prova/131502/exercito-2024-essa-sargento-geral-prova.pdf",
      },
      {
        role: "answer-key",
        url: "https://arquivos.qconcursos.com/prova/arquivo_gabarito/131502/exercito-2024-essa-sargento-geral-gabarito.pdf",
      },
    ],
'''
if text.count(old) != 1:
    raise RuntimeError("sources-audit: ESA documents anchor not unique")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
