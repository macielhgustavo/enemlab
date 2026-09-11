from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2023–2025 da Área Geral, Tipo A: 50 questões objetivas e redação por edição. " +\n',
    '    "Entram 2022–2025 da Área Geral, Tipo A: 50 questões objetivas e redação por edição. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "do QConcursos; em 2023 o fallback é a página pública de prova/questões do QConcursos. " +\n',
    '    "do QConcursos; em 2022–2023 o fallback é a página pública de prova/questões do QConcursos. " +\n',
)

replace_once(
    "src/lib/sources/sources.test.ts",
    '      years: [2025, 2024, 2023],\n',
    '      years: [2025, 2024, 2023, 2022],\n',
)

path = Path("scripts/sources-audit.mjs")
text = path.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key",
        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2023-essa-sargento-geral/questoes",
        method: "GET",
      },
    ],
  },
  {
    providerId: "espcex",
'''
replacement = '''      {
        role: "answer-key",
        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2023-essa-sargento-geral/questoes",
        method: "GET",
      },
      {
        role: "objective-exam",
        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2022-essa-sargento-geral",
        method: "GET",
      },
      {
        role: "answer-key",
        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2022-essa-sargento-geral/questoes",
        method: "GET",
      },
    ],
  },
  {
    providerId: "espcex",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: ESA 2023 anchor not unique")
path.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2023–2025 Tipo A |",
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2022–2025 Tipo A |",
)
