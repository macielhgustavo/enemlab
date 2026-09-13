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
if "2012" in data:
    raise RuntimeError("EsPCEx 2012 already exists")

day1_pdf = "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2012-prova-dia-1-modelo-a-Ylenbr4XbBsZJ3a7.pdf"
day2_pdf = "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2012-prova-dia-2-modelo-d-mnl2br45lks1xrnj.pdf"
data["2012"] = {
    "year": 2012,
    "revision": "altered-2012-10-24",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": day1_pdf,
            "examOfficial": False,
            "answerKeyUrl": "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2012/2012-gabarito-portugues-fisica-e-quimica.pdf",
            "verificationUrl": "https://arquivos.qconcursos.com/prova/arquivo_gabarito/47163/exercito-2012-espcex-cadete-do-exercito-1-dia-gabarito.pdf",
            "annulled": [14],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"E","2":"B","3":"A","4":"D","5":"E","6":"A","7":"D","8":"A","9":"B","10":"C",
                "11":"C","12":"E","13":"B","15":"A","16":"A","17":"B","18":"E","19":"D","20":"C",
                "21":"B","22":"D","23":"B","24":"A","25":"C","26":"B","27":"D","28":"C","29":"E","30":"A","31":"A","32":"C",
                "33":"D","34":"C","35":"D","36":"D","37":"E","38":"E","39":"C","40":"A","41":"E","42":"B","43":"C","44":"B",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": day2_pdf,
            "examOfficial": False,
            "answerKeyUrl": "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2012/2012-gabarito-matematica-geo-his-ing.pdf",
            "verificationUrl": "https://cursoborges.com.br/wp-content/uploads/curso-preparatorio-borges-provas-anteriores-espcex-2_Gabarito_Mat_Geo_His_2012_Ingl_publicacao_2a_prova_alterado.pdf",
            "annulled": [11],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"A","2":"A","3":"B","4":"E","5":"E","6":"E","7":"C","8":"D","9":"C","10":"D",
                "12":"A","13":"C","14":"C","15":"A","16":"D","17":"B","18":"B","19":"D","20":"A",
                "21":"E","22":"C","23":"A","24":"E","25":"D","26":"E","27":"D","28":"C","29":"B","30":"C","31":"A","32":"B",
                "33":"E","34":"B","35":"C","36":"A","37":"C","38":"B","39":"E","40":"C","41":"B","42":"A","43":"E","44":"C",
                "45":"D","46":"D","47":"E","48":"B","49":"A","50":"C","51":"B","52":"A","53":"D","54":"C","55":"A","56":"C",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k13 = espcexAnswerKey(2013)!;\n",
    '''    const k12 = espcexAnswerKey(2012)!;
    expect(k12.revision).toBe("altered-2012-10-24");
    expect(k12.days.day1.model).toBe("A");
    expect(k12.days.day2.model).toBe("D");
    expect(k12.days.day1.total).toBe(44);
    expect(k12.days.day2.total).toBe(56);
    expect(k12.days.day1.annulled).toEqual([14]);
    expect(k12.days.day2.annulled).toEqual([11]);

    const k13 = espcexAnswerKey(2013)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q14 = espcexQuestions(2014).find((q) => q.phase === "day1" && q.number === 10)!;
''',
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    for (const [phase, number] of [["day1", 14], ["day2", 11]] as const) {
      const q12 = espcexQuestions(2012).find((q) => q.phase === phase && q.number === number)!;
      expect(q12.correctAlternative).toBeNull();
      expect(q12.alternatives.every((a) => !a.isCorrect)).toBe(true);
    }
    const q14 = espcexQuestions(2014).find((q) => q.phase === "day1" && q.number === 10)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q13 = espcexQuestions(2013)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q12 = espcexQuestions(2012)[0];
    expect(q12.statementAvailable).toBe(false);
    expect(q12.official?.official).toBe(false);
    expect(q12.official?.documentUrl).toContain("zyrosite.com");

    const q13 = espcexQuestions(2013)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2013)[0])).toBe("espcex-2013-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2013)[0])).toBe("espcex-2013-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2012)[0])).toBe("espcex-2012-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2013 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2012 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2013 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2012 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2011 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2013–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2012–2025 completos no formato atual: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2013–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2012–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "100 itens sem anuladas, com gabaritos confirmados em duas cópias públicas. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
    '''    "100 itens sem anuladas, com gabaritos confirmados em duas cópias públicas. Em 2012 usa-se a revisão " +
    "alterada em 24/10: anuladas 14 (Modelo A, 1º dia) e 11 (Modelo D, 2º dia). 2011 muda para " +
    "quatro cadernos/fases e fica fora deste formato até ser modelado explicitamente. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)

replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013],
    });
  });

  it("descreve a ESA Geral''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012],
    });
  });

  it("descreve a ESA Geral''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2013, "day2").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2013, "day2").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2012, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2012, "day2").official).toBe(false);\n',
)

audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2-verification-mirror",
        url: "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2013/2013-gabarito-matematica-geografia-historia-e-ingles.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2-verification-mirror",
        url: "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2013/2013-gabarito-matematica-geografia-historia-e-ingles.pdf",
      },
      {
        role: "exam-and-altered-key-day1-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2012-prova-dia-1-modelo-a-Ylenbr4XbBsZJ3a7.pdf",
      },
      {
        role: "answer-key-day1-verification-mirror",
        url: "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2012/2012-gabarito-portugues-fisica-e-quimica.pdf",
      },
      {
        role: "exam-and-altered-key-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2012-prova-dia-2-modelo-d-mnl2br45lks1xrnj.pdf",
      },
      {
        role: "answer-key-day2-verification-mirror",
        url: "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2012/2012-gabarito-matematica-geo-his-ing.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2013 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação/Azambuja | `pdf-reference` | referência externa quando espelhado | 2013–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação/Azambuja | `pdf-reference` | referência externa quando espelhado | 2012–2025 (2 dias); 2011 requer fases históricas |",
)
