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
if "2019" in data:
    raise RuntimeError("EsPCEx 2019 already exists")

base = "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2019"
data["2019"] = {
    "year": 2019,
    "revision": "mirror-reviewed-2019",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "B",
            "total": 44,
            "examUrl": f"{base}/provas/2019%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20B.pdf",
            "examOfficial": False,
            "answerKeyUrl": f"{base}/gabarito/2019-gabarito-espcex-1-dia-portquifis.pdf",
            "verificationUrl": f"{base}/gabarito/2019-gabarito-espcex-1-dia-portquifis.pdf",
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"E","2":"B","3":"A","4":"C","5":"E","6":"C","7":"E","8":"C","9":"D","10":"C",
                "11":"A","12":"E","13":"D","14":"E","15":"B","16":"D","17":"A","18":"B","19":"A","20":"C",
                "21":"E","22":"C","23":"C","24":"D","25":"A","26":"D","27":"E","28":"A","29":"B","30":"E","31":"D","32":"A",
                "33":"D","34":"E","35":"C","36":"A","37":"C","38":"D","39":"D","40":"B","41":"A","42":"E","43":"E","44":"C",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": f"{base}/provas/2019%20-%20EsPCEx%20-%20MATGEOHISING%20-%20MODELO%20D.pdf",
            "examOfficial": False,
            "answerKeyUrl": f"{base}/gabarito/2019-gabarito-espcex-2-dia-matgeohising.pdf",
            "verificationUrl": f"{base}/gabarito/2019-gabarito-espcex-2-dia-matgeohising.pdf",
            "annulled": [],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"D","2":"B","3":"B","4":"B","5":"A","6":"E","7":"B","8":"E","9":"D","10":"D",
                "11":"A","12":"E","13":"C","14":"E","15":"A","16":"A","17":"E","18":"E","19":"C","20":"C",
                "21":"A","22":"A","23":"C","24":"D","25":"E","26":"C","27":"D","28":"C","29":"B","30":"E","31":"C","32":"B",
                "33":"D","34":"E","35":"B","36":"D","37":"C","38":"A","39":"B","40":"C","41":"C","42":"B","43":"A","44":"C",
                "45":"C","46":"A","47":"E","48":"A","49":"D","50":"C","51":"C","52":"D","53":"B","54":"E","55":"E","56":"B",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Provider contract: 2019 intentionally uses B/D because those are the cadernos
# exposed by the verified archive; never synthesize an unavailable Model A.
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k20 = espcexAnswerKey(2020)!;\n",
    '''    const k19 = espcexAnswerKey(2019)!;
    expect(k19.revision).toBe("mirror-reviewed-2019");
    expect(k19.days.day1.model).toBe("B");
    expect(k19.days.day2.model).toBe("D");
    expect(k19.days.day1.total).toBe(44);
    expect(k19.days.day2.total).toBe(56);
    expect(k19.days.day1.annulled).toEqual([]);
    expect(k19.days.day2.annulled).toEqual([]);

    const k20 = espcexAnswerKey(2020)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''  it("não chama caderno espelhado de oficial", () => {
    const q20 = espcexQuestions(2020)[0];
''',
    '''  it("não chama caderno espelhado de oficial", () => {
    const q19 = espcexQuestions(2019)[0];
    expect(q19.statementAvailable).toBe(false);
    expect(q19.official?.official).toBe(false);
    expect(q19.official?.documentUrl).toContain("hdocurso.com.br");

    const q20 = espcexQuestions(2020)[0];
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2020)[0])).toBe("espcex-2020-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2020)[0])).toBe("espcex-2020-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2019)[0])).toBe("espcex-2019-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2020 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2019 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2020 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2019 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2018 })).toEqual([]);
''',
)

replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2020–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2019–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2020–2024 os cadernos " +\n',
    '    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2019–2024 os cadernos " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    "Modelo D. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
    '''    "Modelo D. Em 2019 o caderno canônico disponível é Modelo B no 1º dia e Modelo D " +
    "no 2º, ambos sem anuladas no gabarito consultado. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)

# Use a contextual source-test anchor so ESA having a similar years array cannot collide.
replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020],
    });
  });

  it("descreve a ESA Geral''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019],
    });
  });

  it("descreve a ESA Geral''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2020, "day1").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2020, "day1").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2019, "day1").official).toBe(false);\n',
)

# Audit exact cadernos/gabaritos used by the provider.
audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2-definitive-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2020/gabarito/2020%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D%20-%20GABARITO.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2-definitive-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2020/gabarito/2020%20-%20EsPCEx%20-%20MATGEOHISING-%20MODELO%20D%20-%20GABARITO.pdf",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2019/provas/2019%20-%20EsPCEx%20-%20PORTFISQUI%20-%20MODELO%20B.pdf",
      },
      {
        role: "answer-key-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2019/gabarito/2019-gabarito-espcex-1-dia-portquifis.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2019/provas/2019%20-%20EsPCEx%20-%20MATGEOHISING%20-%20MODELO%20D.pdf",
      },
      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2019/gabarito/2019-gabarito-espcex-2-dia-matgeohising.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2020 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2020–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico/ZeroUm/Indagação | `pdf-reference` | referência externa quando espelhado | 2019–2025 (2 dias) |",
)
