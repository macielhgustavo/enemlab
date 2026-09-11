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
if "2017" in data:
    raise RuntimeError("EsPCEx 2017 already exists")

base = "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2017"
data["2017"] = {
    "year": 2017,
    "revision": "mirror-reviewed-2017",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": f"{base}/provas/2017-espcex-1-dia-portquifis-modelo-a.pdf",
            "examOfficial": False,
            "answerKeyUrl": f"{base}/gabarito/2017-gabarito-espcex-1-dia-portquifis.pdf",
            "verificationUrl": f"{base}/gabarito/2017-gabarito-espcex-1-dia-portquifis.pdf",
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"A","2":"E","3":"B","4":"B","5":"C","6":"A","7":"D","8":"C","9":"A","10":"E",
                "11":"C","12":"D","13":"B","14":"B","15":"E","16":"A","17":"E","18":"D","19":"C","20":"A",
                "21":"D","22":"A","23":"B","24":"C","25":"E","26":"C","27":"D","28":"B","29":"E","30":"A","31":"E","32":"C",
                "33":"E","34":"E","35":"C","36":"A","37":"E","38":"D","39":"B","40":"C","41":"D","42":"B","43":"A","44":"D",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": f"{base}/provas/2017-espcex-2-dia-matgeohising-modelo-d.pdf",
            "examOfficial": False,
            "answerKeyUrl": f"{base}/gabarito/2017-gabarito-espcex-2-dia-matgeohising.pdf",
            "verificationUrl": f"{base}/gabarito/2017-gabarito-espcex-2-dia-matgeohising.pdf",
            "annulled": [],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"B","2":"C","3":"A","4":"C","5":"A","6":"E","7":"A","8":"E","9":"A","10":"B",
                "11":"D","12":"C","13":"C","14":"E","15":"D","16":"A","17":"B","18":"E","19":"D","20":"D",
                "21":"C","22":"D","23":"B","24":"E","25":"C","26":"A","27":"A","28":"D","29":"B","30":"E","31":"B","32":"A",
                "33":"E","34":"B","35":"E","36":"C","37":"B","38":"E","39":"A","40":"A","41":"D","42":"A","43":"E","44":"E",
                "45":"B","46":"A","47":"C","48":"D","49":"B","50":"D","51":"B","52":"E","53":"C","54":"A","55":"E","56":"C",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k18 = espcexAnswerKey(2018)!;\n",
    '''    const k17 = espcexAnswerKey(2017)!;
    expect(k17.revision).toBe("mirror-reviewed-2017");
    expect(k17.days.day1.model).toBe("A");
    expect(k17.days.day2.model).toBe("D");
    expect(k17.days.day1.total).toBe(44);
    expect(k17.days.day2.total).toBe(56);
    expect(k17.days.day1.annulled).toEqual([]);
    expect(k17.days.day2.annulled).toEqual([]);

    const k18 = espcexAnswerKey(2018)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q18 = espcexQuestions(2018)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q17 = espcexQuestions(2017)[0];
    expect(q17.statementAvailable).toBe(false);
    expect(q17.official?.official).toBe(false);
    expect(q17.official?.documentUrl).toContain("hdocurso.com.br");

    const q18 = espcexQuestions(2018)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2018)[0])).toBe("espcex-2018-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2018)[0])).toBe("espcex-2018-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2017)[0])).toBe("espcex-2017-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2018 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2017 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2018 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2017 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2016 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2018–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2017–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2018–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2017–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "também sem anuladas. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
    '''    "também sem anuladas. Em 2017 os cadernos canônicos A/D também fecham 100 itens sem " +
    "anuladas. 2016 permanece fora: o acervo público consultado não expõe o caderno do 2º dia. " +
    "Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)

replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018],
    });
  });

  it("descreve a ESA Geral''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017],
    });
  });

  it("descreve a ESA Geral''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2018, "day1").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2018, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2017, "day1").official).toBe(false);\n',
)

audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2018/gabarito/2018-gabarito-espcex-2-dia-matgeohising.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2018/gabarito/2018-gabarito-espcex-2-dia-matgeohising.pdf",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2017/provas/2017-espcex-1-dia-portquifis-modelo-a.pdf",
      },
      {
        role: "answer-key-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2017/gabarito/2017-gabarito-espcex-1-dia-portquifis.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2017/provas/2017-espcex-2-dia-matgeohising-modelo-d.pdf",
      },
      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2017/gabarito/2017-gabarito-espcex-2-dia-matgeohising.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2018 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2018–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2017–2025 (2 dias) |",
)
