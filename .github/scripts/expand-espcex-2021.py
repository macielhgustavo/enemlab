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
if "2021" in data:
    raise RuntimeError("EsPCEx 2021 already exists")

final_mirror = "https://www.indagacao.com.br/2023/03/prova-espcex-2021-1-e-2-dias-com-gabarito.html"
data["2021"] = {
    "year": 2021,
    "revision": "final-mirror-2021",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2021/provas/2021%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20A.pdf",
            "examOfficial": False,
            "answerKeyUrl": final_mirror,
            "verificationUrl": final_mirror,
            "annulled": [39],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"D","2":"B","3":"E","4":"E","5":"D","6":"C","7":"A","8":"C","9":"A","10":"D",
                "11":"B","12":"C","13":"A","14":"C","15":"A","16":"B","17":"E","18":"C","19":"A","20":"D",
                "21":"E","22":"C","23":"D","24":"C","25":"B","26":"A","27":"E","28":"B","29":"A","30":"C","31":"A","32":"D",
                "33":"A","34":"C","35":"B","36":"A","37":"D","38":"E","40":"D","41":"C","42":"D","43":"E","44":"B",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2021/provas/2021%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D.pdf",
            "examOfficial": False,
            "answerKeyUrl": final_mirror,
            "verificationUrl": final_mirror,
            "annulled": [],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"C","2":"C","3":"E","4":"D","5":"E","6":"D","7":"B","8":"A","9":"E","10":"E",
                "11":"D","12":"B","13":"C","14":"D","15":"A","16":"B","17":"A","18":"A","19":"C","20":"B",
                "21":"D","22":"A","23":"A","24":"E","25":"B","26":"B","27":"E","28":"A","29":"D","30":"B","31":"D","32":"C",
                "33":"C","34":"B","35":"A","36":"E","37":"B","38":"C","39":"A","40":"D","41":"E","42":"D","43":"E","44":"C",
                "45":"C","46":"D","47":"A","48":"D","49":"A","50":"B","51":"C","52":"E","53":"E","54":"B","55":"C","56":"B",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k22 = espcexAnswerKey(2022)!;\n",
    '''    const k21 = espcexAnswerKey(2021)!;
    expect(k21.revision).toBe("final-mirror-2021");
    expect(k21.days.day1.model).toBe("A");
    expect(k21.days.day2.model).toBe("D");
    expect(k21.days.day1.total).toBe(44);
    expect(k21.days.day2.total).toBe(56);
    expect(k21.days.day1.annulled).toEqual([39]);

    const k22 = espcexAnswerKey(2022)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q22 = espcexQuestions(2022).find((q) => q.phase === "day2" && q.number === 17)!;
''',
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q21 = espcexQuestions(2021).find((q) => q.phase === "day1" && q.number === 39)!;
    expect(q21.correctAlternative).toBeNull();
    expect(q21.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q22 = espcexQuestions(2022).find((q) => q.phase === "day2" && q.number === 17)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q22 = espcexQuestions(2022)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q21 = espcexQuestions(2021)[0];
    expect(q21.statementAvailable).toBe(false);
    expect(q21.official?.official).toBe(false);
    expect(q21.official?.documentUrl).toContain("hdocurso.com.br");

    const q22 = espcexQuestions(2022)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2022)[0])).toBe("espcex-2022-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2022)[0])).toBe("espcex-2022-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2021)[0])).toBe("espcex-2021-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2022 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2021 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2022 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2021 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2020 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2022–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2021–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2022–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2021–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "do 2º dia, Modelo D, como anulada. Gabaritos são dados factuais e o app não redistribui PDFs.",\n',
    '    "do 2º dia, Modelo D, como anulada; em 2021 a revisão final anula a questão 39 " +\n    "do 1º dia, Modelo A. Gabaritos são dados factuais e o app não redistribui PDFs.",\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    "      years: [2025, 2024, 2023, 2022],\n",
    "      years: [2025, 2024, 2023, 2022, 2021],\n",
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2022, "day1").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2022, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2021, "day1").official).toBe(false);\n',
)

audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-definitive-mirror",
        url: "https://cursozeroum.com.br/wp-content/uploads/2024/04/Espcex2022_Gabarito-1.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-definitive-mirror",
        url: "https://cursozeroum.com.br/wp-content/uploads/2024/04/Espcex2022_Gabarito-1.pdf",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2021/provas/2021%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20A.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2021/provas/2021%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D.pdf",
      },
      {
        role: "answer-key-final-mirror",
        url: "https://www.indagacao.com.br/2023/03/prova-espcex-2021-1-e-2-dias-com-gabarito.html",
        method: "GET",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2022 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm | `pdf-reference` | referência externa quando espelhado | 2022–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2021–2025 (2 dias) |",
)
