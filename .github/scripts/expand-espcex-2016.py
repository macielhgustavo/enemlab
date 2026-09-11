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
if "2016" in data:
    raise RuntimeError("EsPCEx 2016 already exists")

data["2016"] = {
    "year": 2016,
    "revision": "mirror-reviewed-2016",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/provas/Prova_2016_Port_Redacao_Fisica_Quimica.pdf",
            "examOfficial": False,
            "answerKeyUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/gabarito/Gabarito_Port_Red_Fis_Qui_2016.pdf",
            "verificationUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/gabarito/Gabarito_Port_Red_Fis_Qui_2016.pdf",
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"E","2":"A","3":"E","4":"B","5":"A","6":"B","7":"E","8":"C","9":"B","10":"C",
                "11":"E","12":"D","13":"B","14":"D","15":"C","16":"B","17":"D","18":"B","19":"D","20":"C",
                "21":"C","22":"B","23":"D","24":"E","25":"A","26":"C","27":"E","28":"D","29":"A","30":"C","31":"E","32":"D",
                "33":"B","34":"E","35":"B","36":"B","37":"E","38":"D","39":"A","40":"C","41":"C","42":"A","43":"D","44":"A",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2016-prova-dia-2-modelo-d-YX42j47yDnivgMgr.pdf",
            "examOfficial": False,
            "answerKeyUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/gabarito/Gabarito_Mat_Geo_His_2016_Ingl.pdf",
            "verificationUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/gabarito/Gabarito_Mat_Geo_His_2016_Ingl.pdf",
            "annulled": [],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"C","2":"E","3":"C","4":"D","5":"B","6":"C","7":"C","8":"C","9":"A","10":"C",
                "11":"B","12":"B","13":"D","14":"A","15":"D","16":"D","17":"B","18":"A","19":"E","20":"C",
                "21":"A","22":"C","23":"D","24":"E","25":"B","26":"A","27":"E","28":"B","29":"B","30":"C","31":"C","32":"D",
                "33":"E","34":"A","35":"C","36":"A","37":"E","38":"B","39":"B","40":"D","41":"C","42":"E","43":"E","44":"B",
                "45":"D","46":"A","47":"C","48":"A","49":"D","50":"B","51":"B","52":"C","53":"E","54":"C","55":"E","56":"D",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k17 = espcexAnswerKey(2017)!;\n",
    '''    const k16 = espcexAnswerKey(2016)!;
    expect(k16.revision).toBe("mirror-reviewed-2016");
    expect(k16.days.day1.model).toBe("A");
    expect(k16.days.day2.model).toBe("D");
    expect(k16.days.day1.total).toBe(44);
    expect(k16.days.day2.total).toBe(56);
    expect(k16.days.day1.annulled).toEqual([]);
    expect(k16.days.day2.annulled).toEqual([]);

    const k17 = espcexAnswerKey(2017)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q17 = espcexQuestions(2017)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q16 = espcexQuestions(2016)[0];
    expect(q16.statementAvailable).toBe(false);
    expect(q16.official?.official).toBe(false);
    expect(q16.official?.documentUrl).toContain("hdocurso.com.br");
    const q16d2 = espcexQuestions(2016).find((q) => q.phase === "day2" && q.number === 1)!;
    expect(q16d2.official?.official).toBe(false);
    expect(q16d2.official?.documentUrl).toContain("zyrosite.com");

    const q17 = espcexQuestions(2017)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2017)[0])).toBe("espcex-2017-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2017)[0])).toBe("espcex-2017-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2016)[0])).toBe("espcex-2016-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2017 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2016 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2017 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2016 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2015 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2017–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2016–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2017–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2016–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "anuladas. 2016 permanece fora: o acervo público consultado não expõe o caderno do 2º dia. " +
    "Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
    '''    "anuladas. Em 2016, o 1º dia vem do HDO e o caderno D do 2º dia foi recuperado no " +
    "acervo LAPAN; os dois gabaritos A/D foram conferidos sem anuladas. Gabaritos são dados " +
    "factuais e o app não redistribui PDFs.",
''',
)

replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017],
    });
  });

  it("descreve a ESA Geral''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016],
    });
  });

  it("descreve a ESA Geral''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2017, "day1").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2017, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2016, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2016, "day2").official).toBe(false);\n',
)

audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2017/gabarito/2017-gabarito-espcex-2-dia-matgeohising.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2017/gabarito/2017-gabarito-espcex-2-dia-matgeohising.pdf",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/provas/Prova_2016_Port_Redacao_Fisica_Quimica.pdf",
      },
      {
        role: "answer-key-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/gabarito/Gabarito_Port_Red_Fis_Qui_2016.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2016-prova-dia-2-modelo-d-YX42j47yDnivgMgr.pdf",
      },
      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/gabarito/Gabarito_Mat_Geo_His_2016_Ingl.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2017 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2017–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2016–2025 (2 dias) |",
)
