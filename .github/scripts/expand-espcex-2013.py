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
if "2013" in data:
    raise RuntimeError("EsPCEx 2013 already exists")

day1_pdf = "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2013-prova-dia-1-modelo-a-dOqMpKa4G8HDwpar.pdf"
day2_pdf = "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2013-prova-dia-2-modelo-d-m7V2913NWNtoy9Lj.pdf"
data["2013"] = {
    "year": 2013,
    "revision": "final-mirror-2013",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": day1_pdf,
            "examOfficial": False,
            "answerKeyUrl": "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2013/2013-gabarito-portugues-fisica-e-quimica.pdf",
            "verificationUrl": "https://arquivos.qconcursos.com/prova/arquivo_gabarito/37155/exercito-2013-espcex-cadete-do-exercito-1-dia-gabarito.pdf",
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"A","2":"B","3":"E","4":"A","5":"B","6":"C","7":"B","8":"D","9":"D","10":"A",
                "11":"E","12":"C","13":"B","14":"C","15":"A","16":"C","17":"B","18":"D","19":"E","20":"A",
                "21":"A","22":"E","23":"A","24":"E","25":"C","26":"C","27":"B","28":"D","29":"E","30":"B","31":"D","32":"B",
                "33":"B","34":"C","35":"B","36":"C","37":"D","38":"B","39":"D","40":"E","41":"A","42":"A","43":"E","44":"D",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": day2_pdf,
            "examOfficial": False,
            "answerKeyUrl": "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2013/2013-gabarito-matematica-geografia-historia-e-ingles.pdf",
            "verificationUrl": "https://arquivos.qconcursos.com/prova/arquivo_gabarito/37156/exercito-2013-espcex-cadete-do-exercito-2-dia-gabarito.pdf",
            "annulled": [],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"D","2":"A","3":"D","4":"C","5":"D","6":"B","7":"E","8":"A","9":"D","10":"C",
                "11":"A","12":"E","13":"A","14":"E","15":"B","16":"C","17":"B","18":"B","19":"E","20":"C",
                "21":"B","22":"E","23":"C","24":"C","25":"E","26":"C","27":"A","28":"A","29":"D","30":"B","31":"D","32":"D",
                "33":"B","34":"C","35":"D","36":"E","37":"B","38":"C","39":"B","40":"C","41":"B","42":"A","43":"D","44":"A",
                "45":"D","46":"E","47":"B","48":"E","49":"C","50":"D","51":"A","52":"A","53":"B","54":"C","55":"A","56":"C",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k14 = espcexAnswerKey(2014)!;\n",
    '''    const k13 = espcexAnswerKey(2013)!;
    expect(k13.revision).toBe("final-mirror-2013");
    expect(k13.days.day1.model).toBe("A");
    expect(k13.days.day2.model).toBe("D");
    expect(k13.days.day1.total).toBe(44);
    expect(k13.days.day2.total).toBe(56);
    expect(k13.days.day1.annulled).toEqual([]);
    expect(k13.days.day2.annulled).toEqual([]);

    const k14 = espcexAnswerKey(2014)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q14 = espcexQuestions(2014)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q13 = espcexQuestions(2013)[0];
    expect(q13.statementAvailable).toBe(false);
    expect(q13.official?.official).toBe(false);
    expect(q13.official?.documentUrl).toContain("zyrosite.com");

    const q14 = espcexQuestions(2014)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2014)[0])).toBe("espcex-2014-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2014)[0])).toBe("espcex-2014-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2013)[0])).toBe("espcex-2013-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2014 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2013 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2014 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2013 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2012 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2014–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2013–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2014–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2013–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "o Modelo D do 2º dia fecha 56 respostas sem anulação. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
    '''    "o Modelo D do 2º dia fecha 56 respostas sem anulação. Em 2013, os modelos A/D fecham " +
    "100 itens sem anuladas, com gabaritos confirmados em duas cópias públicas. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)

replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014],
    });
  });

  it("descreve a ESA Geral''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013],
    });
  });

  it("descreve a ESA Geral''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2014, "day2").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2014, "day2").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2013, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2013, "day2").official).toBe(false);\n',
)

audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "exam-and-final-key-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2014-prova-dia-2-modelo-d-Ylen44y8DGuVKXzp.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "exam-and-final-key-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2014-prova-dia-2-modelo-d-Ylen44y8DGuVKXzp.pdf",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2013-prova-dia-1-modelo-a-dOqMpKa4G8HDwpar.pdf",
      },
      {
        role: "answer-key-day1-verification-mirror",
        url: "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2013/2013-gabarito-portugues-fisica-e-quimica.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2013-prova-dia-2-modelo-d-m7V2913NWNtoy9Lj.pdf",
      },
      {
        role: "answer-key-day2-verification-mirror",
        url: "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2013/2013-gabarito-matematica-geografia-historia-e-ingles.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2014 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2014–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação/Azambuja | `pdf-reference` | referência externa quando espelhado | 2013–2025 (2 dias) |",
)
