import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("src/lib/providers/espcex/answer-keys.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
if "2018" in data:
    raise RuntimeError("EsPCEx 2018 already exists")

base = "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2018"
data["2018"] = {
    "year": 2018,
    "revision": "mirror-reviewed-2018",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": f"{base}/provas/2018-espcex-1-dia-portquifis-modelo-a.pdf",
            "examOfficial": False,
            "answerKeyUrl": f"{base}/gabarito/2018-gabarito-espcex-1-dia-portquifis.pdf",
            "verificationUrl": f"{base}/gabarito/2018-gabarito-espcex-1-dia-portquifis.pdf",
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"E","2":"C","3":"D","4":"D","5":"E","6":"C","7":"A","8":"D","9":"E","10":"D",
                "11":"A","12":"A","13":"E","14":"D","15":"E","16":"C","17":"D","18":"D","19":"B","20":"C",
                "21":"B","22":"E","23":"D","24":"C","25":"E","26":"C","27":"A","28":"C","29":"B","30":"A","31":"D","32":"E",
                "33":"E","34":"C","35":"C","36":"A","37":"C","38":"D","39":"B","40":"D","41":"E","42":"A","43":"E","44":"B",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": f"{base}/provas/2018-espcex-2-dia-matgeohising-modelo-d.pdf",
            "examOfficial": False,
            "answerKeyUrl": f"{base}/gabarito/2018-gabarito-espcex-2-dia-matgeohising.pdf",
            "verificationUrl": f"{base}/gabarito/2018-gabarito-espcex-2-dia-matgeohising.pdf",
            "annulled": [],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"B","2":"E","3":"B","4":"D","5":"D","6":"E","7":"B","8":"C","9":"C","10":"D",
                "11":"B","12":"D","13":"E","14":"B","15":"C","16":"A","17":"C","18":"D","19":"C","20":"A",
                "21":"D","22":"A","23":"E","24":"C","25":"C","26":"E","27":"A","28":"B","29":"C","30":"A","31":"B","32":"D",
                "33":"B","34":"D","35":"E","36":"B","37":"A","38":"A","39":"C","40":"B","41":"C","42":"A","43":"B","44":"C",
                "45":"E","46":"B","47":"D","48":"C","49":"D","50":"A","51":"C","52":"E","53":"D","54":"B","55":"D","56":"A",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k19 = espcexAnswerKey(2019)!;\n",
    '''    const k18 = espcexAnswerKey(2018)!;
    expect(k18.revision).toBe("mirror-reviewed-2018");
    expect(k18.days.day1.model).toBe("A");
    expect(k18.days.day2.model).toBe("D");
    expect(k18.days.day1.total).toBe(44);
    expect(k18.days.day2.total).toBe(56);
    expect(k18.days.day1.annulled).toEqual([]);
    expect(k18.days.day2.annulled).toEqual([]);

    const k19 = espcexAnswerKey(2019)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q19 = espcexQuestions(2019)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q18 = espcexQuestions(2018)[0];
    expect(q18.statementAvailable).toBe(false);
    expect(q18.official?.official).toBe(false);
    expect(q18.official?.documentUrl).toContain("hdocurso.com.br");

    const q19 = espcexQuestions(2019)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2019)[0])).toBe("espcex-2019-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2019)[0])).toBe("espcex-2019-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2018)[0])).toBe("espcex-2018-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2019 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2018 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2019 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2018 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2017 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2019–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2018–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2019–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2018–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "no 2º, ambos sem anuladas no gabarito consultado. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
    '''    "no 2º, ambos sem anuladas no gabarito consultado. Em 2018 os cadernos canônicos são A/D, " +
    "também sem anuladas. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)

replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019],
    });
  });

  it("descreve a ESA Geral''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018],
    });
  });

  it("descreve a ESA Geral''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2019, "day1").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2019, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2018, "day1").official).toBe(false);\n',
)

audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2019/gabarito/2019-gabarito-espcex-2-dia-matgeohising.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2019/gabarito/2019-gabarito-espcex-2-dia-matgeohising.pdf",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2018/provas/2018-espcex-1-dia-portquifis-modelo-a.pdf",
      },
      {
        role: "answer-key-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2018/gabarito/2018-gabarito-espcex-1-dia-portquifis.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2018/provas/2018-espcex-2-dia-matgeohising-modelo-d.pdf",
      },
      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2018/gabarito/2018-gabarito-espcex-2-dia-matgeohising.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2019 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2019–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2018–2025 (2 dias) |",
)
