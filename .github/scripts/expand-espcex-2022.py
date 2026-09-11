import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("src/lib/providers/espcex/answer-keys.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
if "2022" in data:
    raise RuntimeError("EsPCEx 2022 already exists")

final_key = "https://cursozeroum.com.br/wp-content/uploads/2024/04/Espcex2022_Gabarito-1.pdf"
data["2022"] = {
    "year": 2022,
    "revision": "definitive-2022",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2022/provas/2022%20PROVA%20DIA%201%20MODELO%20A.pdf",
            "examOfficial": False,
            "answerKeyUrl": final_key,
            "verificationUrl": final_key,
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"D","2":"E","3":"E","4":"C","5":"C","6":"D","7":"E","8":"A","9":"D","10":"B",
                "11":"B","12":"C","13":"C","14":"A","15":"B","16":"C","17":"A","18":"D","19":"A","20":"B",
                "21":"D","22":"C","23":"E","24":"C","25":"A","26":"D","27":"B","28":"B","29":"A","30":"C","31":"E","32":"A",
                "33":"A","34":"C","35":"B","36":"D","37":"E","38":"C","39":"A","40":"E","41":"B","42":"B","43":"D","44":"C",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2022/provas/2022%20PROVA%20DIA%202%20MODELO%20D.pdf",
            "examOfficial": False,
            "answerKeyUrl": final_key,
            "verificationUrl": final_key,
            "annulled": [17],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"D","2":"B","3":"A","4":"C","5":"A","6":"E","7":"D","8":"B","9":"E","10":"A",
                "11":"E","12":"E","13":"C","14":"D","15":"B","16":"C","18":"C","19":"C","20":"D",
                "21":"B","22":"B","23":"E","24":"D","25":"A","26":"E","27":"C","28":"A","29":"A","30":"C","31":"E","32":"D",
                "33":"D","34":"E","35":"C","36":"E","37":"B","38":"C","39":"D","40":"A","41":"C","42":"A","43":"E","44":"B",
                "45":"B","46":"A","47":"E","48":"D","49":"C","50":"A","51":"B","52":"C","53":"D","54":"D","55":"E","56":"C",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Provider tests. The generic coverage invariant verifies every answer plus anuladas.
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k23 = espcexAnswerKey(2023)!;\n",
    '''    const k22 = espcexAnswerKey(2022)!;
    expect(k22.revision).toBe("definitive-2022");
    expect(k22.days.day1.model).toBe("A");
    expect(k22.days.day2.model).toBe("D");
    expect(k22.days.day1.total).toBe(44);
    expect(k22.days.day2.total).toBe(56);
    expect(k22.days.day2.annulled).toEqual([17]);

    const k23 = espcexAnswerKey(2023)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q23 = espcexQuestions(2023).find((q) => q.phase === "day2" && q.number === 27)!;
''',
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q22 = espcexQuestions(2022).find((q) => q.phase === "day2" && q.number === 17)!;
    expect(q22.correctAlternative).toBeNull();
    expect(q22.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q23 = espcexQuestions(2023).find((q) => q.phase === "day2" && q.number === 27)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q23 = espcexQuestions(2023)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q22 = espcexQuestions(2022)[0];
    expect(q22.statementAvailable).toBe(false);
    expect(q22.official?.official).toBe(false);
    expect(q22.official?.documentUrl).toContain("hdocurso.com.br");

    const q23 = espcexQuestions(2023)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2023)[0])).toBe("espcex-2023-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2023)[0])).toBe("espcex-2023-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2022)[0])).toBe("espcex-2022-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2023 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2022 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2023 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2022 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2021 })).toEqual([]);
''',
)

# Source metadata and tests.
replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2023–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2022–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2023–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2022–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "`official: false`. Gabaritos são dados factuais e o app não redistribui PDFs.",\n',
    '    "`official: false`. Em 2022 o gabarito definitivo combinado marca a questão 17 " +\n    "do 2º dia, Modelo D, como anulada. Gabaritos são dados factuais e o app não redistribui PDFs.",\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    "      years: [2025, 2024, 2023],\n",
    "      years: [2025, 2024, 2023, 2022],\n",
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2023, "day1").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2023, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2022, "day1").official).toBe(false);\n',
)

# Audit cadernos and the definitive combined key used by both days.
audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/gabarito/2023-gabarito-2-dia-de-prova.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/gabarito/2023-gabarito-2-dia-de-prova.pdf",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2022/provas/2022%20PROVA%20DIA%201%20MODELO%20A.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2022/provas/2022%20PROVA%20DIA%202%20MODELO%20D.pdf",
      },
      {
        role: "answer-key-definitive-mirror",
        url: "https://cursozeroum.com.br/wp-content/uploads/2024/04/Espcex2022_Gabarito-1.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2023 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico | `pdf-reference` | referência externa quando espelhado | 2023–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm | `pdf-reference` | referência externa quando espelhado | 2022–2025 (2 dias) |",
)
