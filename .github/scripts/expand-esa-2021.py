import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Dataset: public QConcursos mirror, never presented as official ESA bytes.
dataset_path = Path("src/lib/providers/esa/answer-keys.generated.json")
dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
if "2021" in dataset:
    raise RuntimeError("ESA 2021 already exists")
dataset["2021"] = {
    "year": 2021,
    "revision": "qconcursos-final-current-2021",
    "parserVersion": "esa-answer-key@1.0.0",
    "variant": "A",
    "total": 50,
    "examUrl": "https://www.qconcursos.com/questoes-militares/provas/exercito-2021-essa-sargento-geral",
    "answerKeyUrl": "https://www.qconcursos.com/questoes-militares/provas/exercito-2021-essa-sargento-geral/questoes",
    "officialArchiveUrl": "http://www.esa.eb.mil.br",
    "verificationUrl": "https://www.qconcursos.com/questoes-militares/provas/exercito-2021-essa-sargento-geral/questoes",
    "annulled": [],
    "subjects": {
        "mathematics": [1, 14],
        "portuguese": [15, 28],
        "history_geography": [29, 40],
        "english": [41, 50],
    },
    "answers": {
        "1": "B", "2": "E", "3": "E", "4": "A", "5": "B", "6": "D", "7": "B", "8": "C", "9": "C", "10": "D",
        "11": "C", "12": "C", "13": "A", "14": "B", "15": "D", "16": "C", "17": "B", "18": "A", "19": "E", "20": "C",
        "21": "B", "22": "D", "23": "A", "24": "D", "25": "A", "26": "C", "27": "C", "28": "D", "29": "A", "30": "D",
        "31": "D", "32": "A", "33": "A", "34": "A", "35": "E", "36": "D", "37": "E", "38": "E", "39": "C", "40": "D",
        "41": "D", "42": "D", "43": "B", "44": "E", "45": "D", "46": "A", "47": "B", "48": "C", "49": "C", "50": "D",
    },
}
dataset = dict(sorted(dataset.items(), key=lambda item: int(item[0])))
dataset_path.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Provider tests: complete coverage guard remains generic; add year-specific checks.
replace_once(
    "src/lib/providers/esa/esa.test.ts",
    "    expect(esaYears()).toEqual([2025, 2024, 2023, 2022]);\n",
    "    expect(esaYears()).toEqual([2025, 2024, 2023, 2022, 2021]);\n",
)
replace_once(
    "src/lib/providers/esa/esa.test.ts",
    "    const k22 = esaAnswerKey(2022)!;\n",
    '''    const k21 = esaAnswerKey(2021)!;
    expect(k21.revision).toBe("qconcursos-final-current-2021");
    expect(k21.variant).toBe("A");
    expect(k21.total).toBe(50);
    expect(k21.annulled).toEqual([]);

    const k22 = esaAnswerKey(2022)!;
''',
)
replace_once(
    "src/lib/providers/esa/esa.test.ts",
    "      [2022, [5, 18]],\n",
    "      [2021, []],\n      [2022, [5, 18]],\n",
)
replace_once(
    "src/lib/providers/esa/esa.test.ts",
    "    const q22 = esaQuestions(2022);\n",
    '''    const q21 = esaQuestions(2021);
    expect(q21.find((q) => q.number === 1)?.correctAlternative).toBe("B");
    expect(q21.find((q) => q.number === 21)?.correctAlternative).toBe("B");
    expect(q21.find((q) => q.number === 29)?.correctAlternative).toBe("A");
    expect(q21.find((q) => q.number === 41)?.correctAlternative).toBe("D");
    expect(q21.find((q) => q.number === 50)?.correctAlternative).toBe("D");

    const q22 = esaQuestions(2022);
''',
)
replace_once(
    "src/lib/providers/esa/esa.test.ts",
    '    expect(esaQuestionKey(esaQuestions(2022)[0])).toBe("esa-2022-single-1");\n',
    '    expect(esaQuestionKey(esaQuestions(2022)[0])).toBe("esa-2022-single-1");\n    expect(esaQuestionKey(esaQuestions(2021)[0])).toBe("esa-2021-single-1");\n',
)
replace_once(
    "src/lib/providers/esa/esa.test.ts",
    '''    expect(await esaProvider.fetchQuestions({ year: 2022 })).toHaveLength(50);
    expect(await esaProvider.fetchQuestions({ year: 2021 })).toEqual([]);
''',
    '''    expect(await esaProvider.fetchQuestions({ year: 2022 })).toHaveLength(50);
    expect(await esaProvider.fetchQuestions({ year: 2021 })).toHaveLength(50);
    expect(await esaProvider.fetchQuestions({ year: 2020 })).toEqual([]);
''',
)

# Source metadata and source tests.
replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2022–2025 da Área Geral, Tipo A: 50 questões objetivas e redação por edição. " +\n',
    '    "Entram 2021–2025 da Área Geral, Tipo A: 50 questões objetivas e redação por edição. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "do QConcursos; em 2022–2023 o fallback é a página pública de prova/questões do QConcursos. " +\n',
    '    "do QConcursos; em 2021–2023 o fallback é a página pública de prova/questões do QConcursos. " +\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '      years: [2025, 2024, 2023, 2022],\n',
    '      years: [2025, 2024, 2023, 2022, 2021],\n',
)

# Source audit: validate the exact public mirror pages used by the provider.
audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key",
        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2022-essa-sargento-geral/questoes",
        method: "GET",
      },
    ],
  },
  {
    providerId: "espcex",
'''
replacement = '''      {
        role: "answer-key",
        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2022-essa-sargento-geral/questoes",
        method: "GET",
      },
      {
        role: "objective-exam",
        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2021-essa-sargento-geral",
        method: "GET",
      },
      {
        role: "answer-key",
        url: "https://www.qconcursos.com/questoes-militares/provas/exercito-2021-essa-sargento-geral/questoes",
        method: "GET",
      },
    ],
  },
  {
    providerId: "espcex",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: ESA 2022 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2022–2025 Tipo A |",
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2021–2025 Tipo A |",
)
