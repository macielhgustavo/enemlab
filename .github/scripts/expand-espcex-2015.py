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
if "2015" in data:
    raise RuntimeError("EsPCEx 2015 already exists")

day1_pdf = "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2015-prova-dia-1-modelo-a-dJolPoKq7PiZEqXY.pdf"
day2_pdf = "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2015-prova-dia-2-modelo-d-mp8M48Vn8eiRZyNz.pdf"
data["2015"] = {
    "year": 2015,
    "revision": "final-mirror-2015",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": day1_pdf,
            "examOfficial": False,
            "answerKeyUrl": day1_pdf,
            "verificationUrl": day1_pdf,
            "annulled": [2],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"D","3":"B","4":"C","5":"E","6":"C","7":"A","8":"E","9":"D","10":"E",
                "11":"B","12":"E","13":"E","14":"C","15":"E","16":"D","17":"A","18":"B","19":"D","20":"C",
                "21":"C","22":"C","23":"D","24":"B","25":"E","26":"D","27":"C","28":"B","29":"A","30":"D","31":"E","32":"D",
                "33":"A","34":"E","35":"D","36":"B","37":"D","38":"B","39":"C","40":"A","41":"C","42":"E","43":"C","44":"E",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": day2_pdf,
            "examOfficial": False,
            "answerKeyUrl": day2_pdf,
            "verificationUrl": day2_pdf,
            "annulled": [2],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"B","3":"B","4":"A","5":"E","6":"A","7":"E","8":"C","9":"E","10":"C",
                "11":"A","12":"C","13":"E","14":"B","15":"D","16":"E","17":"C","18":"C","19":"D","20":"B",
                "21":"D","22":"D","23":"A","24":"B","25":"C","26":"A","27":"E","28":"E","29":"A","30":"C","31":"E","32":"B",
                "33":"D","34":"D","35":"A","36":"E","37":"E","38":"C","39":"E","40":"D","41":"B","42":"B","43":"C","44":"A",
                "45":"C","46":"E","47":"D","48":"A","49":"E","50":"B","51":"B","52":"C","53":"D","54":"E","55":"C","56":"B",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k16 = espcexAnswerKey(2016)!;\n",
    '''    const k15 = espcexAnswerKey(2015)!;
    expect(k15.revision).toBe("final-mirror-2015");
    expect(k15.days.day1.model).toBe("A");
    expect(k15.days.day2.model).toBe("D");
    expect(k15.days.day1.total).toBe(44);
    expect(k15.days.day2.total).toBe(56);
    expect(k15.days.day1.annulled).toEqual([2]);
    expect(k15.days.day2.annulled).toEqual([2]);

    const k16 = espcexAnswerKey(2016)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    const q20 = espcexQuestions(2020).find((q) => q.phase === "day2" && q.number === 39)!;
''',
    '''  it("preserva anuladas sem marcar alternativa correta", () => {
    for (const phase of ["day1", "day2"] as const) {
      const q15 = espcexQuestions(2015).find((q) => q.phase === phase && q.number === 2)!;
      expect(q15.correctAlternative).toBeNull();
      expect(q15.alternatives.every((a) => !a.isCorrect)).toBe(true);
    }
    const q20 = espcexQuestions(2020).find((q) => q.phase === "day2" && q.number === 39)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q16 = espcexQuestions(2016)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q15 = espcexQuestions(2015)[0];
    expect(q15.statementAvailable).toBe(false);
    expect(q15.official?.official).toBe(false);
    expect(q15.official?.documentUrl).toContain("zyrosite.com");

    const q16 = espcexQuestions(2016)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2016)[0])).toBe("espcex-2016-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2016)[0])).toBe("espcex-2016-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2015)[0])).toBe("espcex-2015-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2016 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2015 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2016 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2015 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2014 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2016–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2015–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2016–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2015–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "acervo LAPAN; os dois gabaritos A/D foram conferidos sem anuladas. Gabaritos são dados " +
    "factuais e o app não redistribui PDFs.",
''',
    '''    "acervo LAPAN; os dois gabaritos A/D foram conferidos sem anuladas. Em 2015, cada PDF " +
    "LAPAN traz no fim o gabarito com alterações destacadas: a questão 2 fica anulada nos modelos " +
    "A e D usados pelo provider. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)

replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016],
    });
  });

  it("descreve a ESA Geral''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015],
    });
  });

  it("descreve a ESA Geral''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2016, "day2").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2016, "day2").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2015, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2015, "day2").official).toBe(false);\n',
)

audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/gabarito/Gabarito_Mat_Geo_His_2016_Ingl.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2016/gabarito/Gabarito_Mat_Geo_His_2016_Ingl.pdf",
      },
      {
        role: "exam-and-final-key-day1-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2015-prova-dia-1-modelo-a-dJolPoKq7PiZEqXY.pdf",
      },
      {
        role: "exam-and-final-key-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2015-prova-dia-2-modelo-d-mp8M48Vn8eiRZyNz.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2016 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2016–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2015–2025 (2 dias) |",
)
