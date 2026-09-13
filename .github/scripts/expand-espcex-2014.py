import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("src/lib/providers/espcex/answer-keys.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
if "2014" in data:
    raise RuntimeError("EsPCEx 2014 already exists")

day1_pdf = "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2014-prova-dia-1-modelo-a-dOqMZZ4D8vS8XjW7.pdf"
day2_pdf = "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2014-prova-dia-2-modelo-d-Ylen44y8DGuVKXzp.pdf"
data["2014"] = {
    "year": 2014,
    "revision": "final-mirror-2014",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": day1_pdf,
            "examOfficial": False,
            "answerKeyUrl": day1_pdf,
            "verificationUrl": "https://cursoborges.com.br/wp-content/uploads/curso-preparatorio-borges-provas-anteriores-espcex-Gabarito-Dia-30Ago14.pdf",
            "annulled": [10],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"E","2":"A","3":"D","4":"C","5":"B","6":"D","7":"B","8":"D","9":"B",
                "11":"B","12":"D","13":"C","14":"A","15":"E","16":"C","17":"E","18":"B","19":"D","20":"C",
                "21":"B","22":"A","23":"D","24":"E","25":"B","26":"A","27":"E","28":"E","29":"C","30":"A","31":"D","32":"C",
                "33":"B","34":"B","35":"A","36":"E","37":"C","38":"E","39":"A","40":"B","41":"D","42":"D","43":"D","44":"C",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": day2_pdf,
            "examOfficial": False,
            "answerKeyUrl": day2_pdf,
            "verificationUrl": day2_pdf,
            "annulled": [],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"D","2":"D","3":"A","4":"D","5":"B","6":"D","7":"E","8":"B","9":"A","10":"C",
                "11":"C","12":"E","13":"B","14":"C","15":"A","16":"B","17":"C","18":"D","19":"E","20":"B",
                "21":"A","22":"C","23":"D","24":"D","25":"E","26":"C","27":"B","28":"E","29":"A","30":"B","31":"C","32":"D",
                "33":"A","34":"B","35":"C","36":"A","37":"C","38":"D","39":"C","40":"D","41":"D","42":"E","43":"D","44":"B",
                "45":"A","46":"D","47":"B","48":"C","49":"C","50":"B","51":"E","52":"A","53":"B","54":"D","55":"C","56":"E",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k15 = espcexAnswerKey(2015)!;\n",
    '''    const k14 = espcexAnswerKey(2014)!;
    expect(k14.revision).toBe("final-mirror-2014");
    expect(k14.days.day1.model).toBe("A");
    expect(k14.days.day2.model).toBe("D");
    expect(k14.days.day1.total).toBe(44);
    expect(k14.days.day2.total).toBe(56);
    expect(k14.days.day1.annulled).toEqual([10]);
    expect(k14.days.day2.annulled).toEqual([]);

    const k15 = espcexAnswerKey(2015)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    for (const phase of ["day1", "day2"] as const) {
''',
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q14 = espcexQuestions(2014).find((q) => q.phase === "day1" && q.number === 10)!;
    expect(q14.correctAlternative).toBeNull();
    expect(q14.alternatives.every((a) => !a.isCorrect)).toBe(true);
    for (const phase of ["day1", "day2"] as const) {
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q15 = espcexQuestions(2015)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q14 = espcexQuestions(2014)[0];
    expect(q14.statementAvailable).toBe(false);
    expect(q14.official?.official).toBe(false);
    expect(q14.official?.documentUrl).toContain("zyrosite.com");

    const q15 = espcexQuestions(2015)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2015)[0])).toBe("espcex-2015-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2015)[0])).toBe("espcex-2015-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2014)[0])).toBe("espcex-2014-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2015 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2014 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2015 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2014 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2013 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2015–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2014–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2015–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2014–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "A e D usados pelo provider. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
    '''    "A e D usados pelo provider. Em 2014, o Modelo A do 1º dia tem a questão 10 anulada; " +
    "o Modelo D do 2º dia fecha 56 respostas sem anulação. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)

replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015],
    });
  });

  it("descreve a ESA Geral''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014],
    });
  });

  it("descreve a ESA Geral''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2015, "day2").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2015, "day2").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2014, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2014, "day2").official).toBe(false);\n',
)

audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "exam-and-final-key-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2015-prova-dia-2-modelo-d-mp8M48Vn8eiRZyNz.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "exam-and-final-key-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2015-prova-dia-2-modelo-d-mp8M48Vn8eiRZyNz.pdf",
      },
      {
        role: "exam-and-final-key-day1-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2014-prova-dia-1-modelo-a-dOqMZZ4D8vS8XjW7.pdf",
      },
      {
        role: "answer-key-day1-verification-mirror",
        url: "https://cursoborges.com.br/wp-content/uploads/curso-preparatorio-borges-provas-anteriores-espcex-Gabarito-Dia-30Ago14.pdf",
      },
      {
        role: "exam-and-final-key-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2014-prova-dia-2-modelo-d-Ylen44y8DGuVKXzp.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2015 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2015–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2014–2025 (2 dias) |",
)
