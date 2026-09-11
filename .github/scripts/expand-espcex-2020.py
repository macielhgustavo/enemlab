import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("src/lib/providers/espcex/answer-keys.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
if "2020" in data:
    raise RuntimeError("EsPCEx 2020 already exists")

base = "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2020"
data["2020"] = {
    "year": 2020,
    "revision": "definitive-2020",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": f"{base}/provas/2020%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20A.pdf",
            "examOfficial": False,
            "answerKeyUrl": f"{base}/gabarito/2020%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20A%20-%20GABARITO.pdf",
            "verificationUrl": f"{base}/gabarito/2020%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20A%20-%20GABARITO.pdf",
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"D","2":"A","3":"D","4":"A","5":"B","6":"C","7":"B","8":"A","9":"A","10":"D",
                "11":"B","12":"E","13":"D","14":"E","15":"B","16":"E","17":"E","18":"C","19":"A","20":"C",
                "21":"C","22":"D","23":"D","24":"C","25":"E","26":"E","27":"A","28":"A","29":"B","30":"B","31":"B","32":"A",
                "33":"B","34":"C","35":"B","36":"E","37":"E","38":"D","39":"A","40":"D","41":"A","42":"C","43":"D","44":"A",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": f"{base}/provas/2020%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D.pdf",
            "examOfficial": False,
            "answerKeyUrl": f"{base}/gabarito/2020%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D%20-%20GABARITO.pdf",
            "verificationUrl": f"{base}/gabarito/2020%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D%20-%20GABARITO.pdf",
            "annulled": [39],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"D","2":"D","3":"D","4":"E","5":"B","6":"D","7":"C","8":"E","9":"B","10":"A",
                "11":"B","12":"A","13":"E","14":"C","15":"B","16":"B","17":"E","18":"A","19":"A","20":"C",
                "21":"D","22":"B","23":"A","24":"D","25":"A","26":"B","27":"C","28":"E","29":"E","30":"C","31":"A","32":"B",
                "33":"C","34":"A","35":"D","36":"C","37":"B","38":"D","40":"B","41":"A","42":"C","43":"E","44":"D",
                "45":"A","46":"C","47":"D","48":"C","49":"B","50":"D","51":"A","52":"E","53":"B","54":"A","55":"E","56":"E",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Provider contract: every edition must remain complete and contiguous.
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k21 = espcexAnswerKey(2021)!;\n",
    '''    const k20 = espcexAnswerKey(2020)!;
    expect(k20.revision).toBe("definitive-2020");
    expect(k20.days.day1.model).toBe("A");
    expect(k20.days.day2.model).toBe("D");
    expect(k20.days.day1.total).toBe(44);
    expect(k20.days.day2.total).toBe(56);
    expect(k20.days.day2.annulled).toEqual([39]);

    const k21 = espcexAnswerKey(2021)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q21 = espcexQuestions(2021).find((q) => q.phase === "day1" && q.number === 39)!;
''',
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q20 = espcexQuestions(2020).find((q) => q.phase === "day2" && q.number === 39)!;
    expect(q20.correctAlternative).toBeNull();
    expect(q20.alternatives.every((a) => !a.isCorrect)).toBe(true);
    const q21 = espcexQuestions(2021).find((q) => q.phase === "day1" && q.number === 39)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q21 = espcexQuestions(2021)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q20 = espcexQuestions(2020)[0];
    expect(q20.statementAvailable).toBe(false);
    expect(q20.official?.official).toBe(false);
    expect(q20.official?.documentUrl).toContain("hdocurso.com.br");

    const q21 = espcexQuestions(2021)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2021)[0])).toBe("espcex-2021-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2021)[0])).toBe("espcex-2021-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2020)[0])).toBe("espcex-2020-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2021 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2020 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2021 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2020 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2019 })).toEqual([]);
''',
)

# Source metadata follows the executable provider and records the final-key annulment.
replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2021–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2020–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2021–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2020–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "do 1º dia, Modelo A. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
    '''    "do 1º dia, Modelo A; em 2020 o gabarito definitivo anula a questão 39 do 2º dia, " +
    "Modelo D. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    "      years: [2025, 2024, 2023, 2022, 2021],\n",
    "      years: [2025, 2024, 2023, 2022, 2021, 2020],\n",
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2021, "day1").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2021, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2020, "day1").official).toBe(false);\n',
)

# Source audit follows the exact HDO documents used by the provider.
audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-final-mirror",
        url: "https://www.indagacao.com.br/2023/03/prova-espcex-2021-1-e-2-dias-com-gabarito.html",
        method: "GET",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-final-mirror",
        url: "https://www.indagacao.com.br/2023/03/prova-espcex-2021-1-e-2-dias-com-gabarito.html",
        method: "GET",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2020/provas/2020%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20A.pdf",
      },
      {
        role: "answer-key-day1-definitive-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2020/gabarito/2020%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20A%20-%20GABARITO.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2020/provas/2020%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D.pdf",
      },
      {
        role: "answer-key-day2-definitive-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2020/gabarito/2020%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D%20-%20GABARITO.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2021 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2021–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2020–2025 (2 dias) |",
)
