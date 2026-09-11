from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Source metadata: 2023 is validated from the public QConcursos mirror page,
# while 2024–2025 have direct mirrored PDFs. None is presented as official.
replace_once(
    "src/lib/sources/index.ts",
    '''  notes:\n    "Entra somente a Área Geral de 2025, Tipo A: 50 questões objetivas e redação. " +\n    "O caderno identifica a ESA e informa esa.eb.mil.br como local oficial do gabarito; " +\n    "os bytes verificáveis usados pelo app vêm de espelhos públicos QConcursos/HDO. " +\n    "Por isso o app não marca a URL espelhada como oficial e não redistribui o PDF.",\n''',
    '''  notes:\n    "Entram 2023–2025 da Área Geral, Tipo A: 50 questões objetivas e redação por edição. " +\n    "Os cadernos identificam a ESA e apontam esa.eb.mil.br como arquivo oficial; " +\n    "a verificação disponível ao app usa espelhos públicos. Em 2024–2025 há PDFs diretos " +\n    "do QConcursos; em 2023 o fallback é a página pública de prova/questões do QConcursos. " +\n    "Nenhuma URL espelhada é marcada como oficial e o app não redistribui os documentos.",\n''',
)

# Source registry tests follow the provider's validated years.
replace_once(
    "src/lib/sources/sources.test.ts",
    '      years: [2025, 2024],\n',
    '      years: [2025, 2024, 2023],\n',
)

# Add 2023 mirror pages to the source audit. They are HTML references rather
# than guessed PDF URLs, deliberately preserving fail-closed behavior.
path = Path("scripts/sources-audit.mjs")
text = path.read_text(encoding="utf-8")
anchor = '''      {\n        role: "answer-key",\n        url: "https://arquivos.qconcursos.com/prova/arquivo_gabarito/131502/exercito-2024-essa-sargento-geral-gabarito.pdf",\n      },\n    ],\n  },\n  {\n    providerId: "espcex",\n'''
replacement = '''      {\n        role: "answer-key",\n        url: "https://arquivos.qconcursos.com/prova/arquivo_gabarito/131502/exercito-2024-essa-sargento-geral-gabarito.pdf",\n      },\n      {\n        role: "objective-exam",\n        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2023-essa-sargento-geral",\n        method: "GET",\n      },\n      {\n        role: "answer-key",\n        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2023-essa-sargento-geral/questoes",\n        method: "GET",\n      },\n    ],\n  },\n  {\n    providerId: "espcex",\n'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: ESA 2024 anchor not unique")
path.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2024–2025 Tipo A |",
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2023–2025 Tipo A |",
)
