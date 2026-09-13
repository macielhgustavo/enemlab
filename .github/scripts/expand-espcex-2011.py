import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Generic phases: 2011 EsPCEx was applied in four distinct sessions.
replace_once(
    "src/lib/providers/types.ts",
    '  | "day1"\n  | "day2"\n',
    '  | "day1"\n  | "day2"\n  | "day3"\n  | "day4"\n',
)
replace_once(
    "src/lib/providers/label.ts",
    '  if (phase === "day2") return "dia 2";\n',
    '  if (phase === "day2") return "dia 2";\n  if (phase === "day3") return "dia 3";\n  if (phase === "day4") return "dia 4";\n',
)

# Dataset: 2011 uses four sessions and different model letters per session.
path = Path("src/lib/providers/espcex/answer-keys.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
if "2011" in data:
    raise RuntimeError("EsPCEx 2011 already exists")

combined_key = "https://arquivos.qconcursos.com/prova/arquivo_gabarito/26125/exercito-2011-espcex-cadete-do-exercito-3-dia-gabarito.pdf"
data["2011"] = {
    "year": 2011,
    "revision": "official-key-mirror-2011",
    "parserVersion": "espcex-answer-key@1.1.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 30,
            "examUrl": "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2011-modelo-a-matematica-1-m2W1n1Wa3qCVygD9.pdf",
            "examOfficial": False,
            "answerKeyUrl": combined_key,
            "verificationUrl": "https://www.concursosmilitares.com.br/provas-anteriores/exercito/espcex/2011espcex_matematica.pdf",
            "annulled": [],
            "subjects": {"mathematics": list(range(1, 31))},
            "answers": {
                "1":"E","2":"C","3":"E","4":"D","5":"B","6":"E","7":"B","8":"D","9":"D","10":"D",
                "11":"D","12":"A","13":"C","14":"A","15":"B","16":"A","17":"E","18":"D","19":"A","20":"C",
                "21":"B","22":"A","23":"B","24":"C","25":"C","26":"A","27":"E","28":"E","29":"B","30":"A"
            },
        },
        "day2": {
            "model": "D",
            "total": 30,
            "examUrl": "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2011-modelo-d-portugues-e-redacao-YD0rer93lBuVlL8o.pdf",
            "examOfficial": False,
            "answerKeyUrl": combined_key,
            "verificationUrl": "https://arquivos.qconcursos.com/prova/arquivo_prova/26128/exercito-2011-espcex-cadete-do-exercito-2-dia-prova.pdf",
            "annulled": [],
            "subjects": {"portuguese": list(range(1, 31))},
            "answers": {
                "1":"E","2":"D","3":"B","4":"E","5":"C","6":"D","7":"B","8":"D","9":"E","10":"D",
                "11":"B","12":"D","13":"E","14":"B","15":"D","16":"C","17":"D","18":"C","19":"B","20":"E",
                "21":"A","22":"C","23":"A","24":"A","25":"B","26":"D","27":"B","28":"C","29":"C","30":"E"
            },
        },
        "day3": {
            "model": "G",
            "total": 40,
            "examUrl": "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2011-modelo-g-fisica-e-quimica-Yg27v7GrkyuJ3X1o.pdf",
            "examOfficial": False,
            "answerKeyUrl": combined_key,
            "verificationUrl": combined_key,
            "annulled": [],
            "subjects": {
                "physics": list(range(1, 21)),
                "chemistry": list(range(21, 41)),
            },
            "answers": {
                "1":"D","2":"C","3":"B","4":"A","5":"C","6":"D","7":"D","8":"C","9":"E","10":"B",
                "11":"B","12":"E","13":"D","14":"A","15":"D","16":"A","17":"E","18":"E","19":"C","20":"B",
                "21":"B","22":"B","23":"A","24":"D","25":"C","26":"A","27":"E","28":"D","29":"E","30":"C",
                "31":"D","32":"E","33":"D","34":"B","35":"B","36":"B","37":"C","38":"B","39":"C","40":"B"
            },
        },
        "day4": {
            "model": "J",
            "total": 45,
            "examUrl": "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2011-modelo-j-geografia-historia-e-ingles-YZ9MZM4qn2SPK89b.pdf",
            "examOfficial": False,
            "answerKeyUrl": combined_key,
            "verificationUrl": combined_key,
            "annulled": [],
            "subjects": {
                "geography": list(range(1, 16)),
                "history": list(range(16, 31)),
                "english": list(range(31, 46)),
            },
            "answers": {
                "1":"B","2":"D","3":"A","4":"C","5":"A","6":"A","7":"A","8":"D","9":"D","10":"C",
                "11":"C","12":"E","13":"E","14":"E","15":"B","16":"B","17":"E","18":"B","19":"D","20":"C",
                "21":"A","22":"D","23":"E","24":"C","25":"E","26":"A","27":"D","28":"C","29":"C","30":"B",
                "31":"E","32":"D","33":"C","34":"E","35":"A","36":"E","37":"A","38":"D","39":"B","40":"B",
                "41":"C","42":"B","43":"A","44":"E","45":"C"
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Provider: phases are now data-driven instead of hard-coded to two days.
replace_once(
    "src/lib/providers/espcex/index.ts",
    'export const ESPCEX_PROVIDER_ID = "espcex";\n\n',
    'export const ESPCEX_PROVIDER_ID = "espcex";\n\nexport type EspcexPhase = "day1" | "day2" | "day3" | "day4";\nconst ESPCEX_PHASES: EspcexPhase[] = ["day1", "day2", "day3", "day4"];\n\n',
)
replace_once(
    "src/lib/providers/espcex/index.ts",
    '''  days: {
    day1: EspcexDayKey;
    day2: EspcexDayKey;
  };
''',
    '''  days: Partial<Record<EspcexPhase, EspcexDayKey>>;
''',
)
replace_once(
    "src/lib/providers/espcex/index.ts",
    '''export function espcexExamUrl(year: number, phase: "day1" | "day2"): string | null {
  return espcexAnswerKey(year)?.days[phase].examUrl ?? null;
}

export function espcexExamOfficial(year: number, phase: "day1" | "day2"): boolean {
  const day = espcexAnswerKey(year)?.days[phase];
  return day ? (day.examOfficial ?? true) : false;
}

export function espcexAnswerKeyUrl(year: number, phase: "day1" | "day2"): string | null {
  return espcexAnswerKey(year)?.days[phase].answerKeyUrl ?? null;
}
''',
    '''export function espcexPhases(year: number): EspcexPhase[] {
  const key = espcexAnswerKey(year);
  return key ? ESPCEX_PHASES.filter((phase) => Boolean(key.days[phase])) : [];
}

export function espcexExamUrl(year: number, phase: EspcexPhase): string | null {
  return espcexAnswerKey(year)?.days[phase]?.examUrl ?? null;
}

export function espcexExamOfficial(year: number, phase: EspcexPhase): boolean {
  const day = espcexAnswerKey(year)?.days[phase];
  return day ? (day.examOfficial ?? true) : false;
}

export function espcexAnswerKeyUrl(year: number, phase: EspcexPhase): string | null {
  return espcexAnswerKey(year)?.days[phase]?.answerKeyUrl ?? null;
}
''',
)
replace_once(
    "src/lib/providers/espcex/index.ts",
    'function questionsForDay(year: number, phase: "day1" | "day2"): NormalizedQuestion[] {\n  const key = espcexAnswerKey(year);\n  if (!key) return [];\n  const day = key.days[phase];\n',
    'function questionsForDay(year: number, phase: EspcexPhase): NormalizedQuestion[] {\n  const key = espcexAnswerKey(year);\n  if (!key) return [];\n  const day = key.days[phase];\n  if (!day) return [];\n',
)
replace_once(
    "src/lib/providers/espcex/index.ts",
    '''export function espcexQuestions(year: number): NormalizedQuestion[] {
  if (!espcexAnswerKey(year)) return [];
  return [...questionsForDay(year, "day1"), ...questionsForDay(year, "day2")];
}
''',
    '''export function espcexQuestions(year: number): NormalizedQuestion[] {
  return espcexPhases(year).flatMap((phase) => questionsForDay(year, phase));
}
''',
)
replace_once(
    "src/lib/providers/espcex/index.ts",
    '  phases: ["day1", "day2"],\n',
    '  phases: ["day1", "day2", "day3", "day4"],\n',
)

# Catalog: enumerate actual phases in each year.
replace_once(
    "src/lib/catalog/current.ts",
    '  espcexAnswerKey,\n  ESPCEX_PROVIDER_ID,\n',
    '  espcexAnswerKey,\n  espcexPhases,\n  ESPCEX_PROVIDER_ID,\n',
)
replace_once(
    "src/lib/catalog/current.ts",
    '        for (const phase of ["day1", "day2"] as const) {\n          const day = key.days[phase];\n',
    '        for (const phase of espcexPhases(ano)) {\n          const day = key.days[phase]!;\n',
)

# Importer/source: expose all four historical phases and preserve mirror provenance.
replace_once(
    "src/lib/sources/index.ts",
    'import { espcexExamOfficial, espcexExamUrl, espcexYears } from "../providers/espcex";\n',
    'import { espcexExamOfficial, espcexExamUrl, espcexPhases, espcexYears } from "../providers/espcex";\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '  phases: ["day1", "day2"],\n',
    '  phases: ["day1", "day2", "day3", "day4"],\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''  provenanceFor(year, phase = "day1", page) {
    const selectedPhase = phase === "day2" ? "day2" : "day1";
    const url = espcexExamUrl(year, selectedPhase) ?? espcexSource.archiveUrl;
    return {
      ...provenance(espcexSource, url, page),
      official: espcexExamOfficial(year, selectedPhase),
    };
  },
''',
    '''  provenanceFor(year, phase = "day1", page) {
    const selectedPhase = espcexPhases(year).find((candidate) => candidate === phase) ?? "day1";
    const url = espcexExamUrl(year, selectedPhase) ?? espcexSource.archiveUrl;
    return {
      ...provenance(espcexSource, url, page),
      official: espcexExamOfficial(year, selectedPhase),
    };
  },
''',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "Entram 2012–2025 completos no formato atual: 44 questões objetivas no 1º dia e 56 no 2º. " +\n',
    '    "Entram 2012–2025 no formato de dois dias e 2011 no formato histórico de quatro sessões. " +\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '    "quatro cadernos/fases e fica fora deste formato até ser modelado explicitamente. Gabaritos são dados factuais e o app não redistribui PDFs.",\n',
    '    "quatro cadernos/fases: Matemática (30), Português/Redação (30 objetivas), Física/Química (40) e " +\n    "Geografia/História/Inglês (45). Gabaritos são dados factuais e o app não redistribui PDFs.",\n',
)

# Provider tests: keep the old-format invariant for 2012+ and assert 2011 separately.
test = Path("src/lib/providers/espcex/espcex.test.ts")
text = test.read_text(encoding="utf-8")
text = text.replace(
    '  espcexProvider,\n',
    '  espcexPhases,\n  espcexProvider,\n',
    1,
)
text = text.replace(
    '    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012]);\n',
    '    expect(espcexYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011]);\n\n    const k11 = espcexAnswerKey(2011)!;\n    expect(k11.revision).toBe("official-key-mirror-2011");\n    expect(espcexPhases(2011)).toEqual(["day1", "day2", "day3", "day4"]);\n    expect([k11.days.day1!.total, k11.days.day2!.total, k11.days.day3!.total, k11.days.day4!.total]).toEqual([30, 30, 40, 45]);\n',
    1,
)
text = text.replace(
    '      for (const day of [key.days.day1, key.days.day2]) {\n        const covered = [...Object.keys(day.answers).map(Number), ...day.annulled].sort((a, b) => a - b);\n',
    '      for (const phase of espcexPhases(year)) {\n        const day = key.days[phase]!;\n        const covered = [...Object.keys(day.answers).map(Number), ...day.annulled].sort((a, b) => a - b);\n',
    1,
)
old_block = '''  it("gera os dois dias sem misturar numeração", () => {
    for (const year of espcexYears()) {
      const questions = espcexQuestions(year);
      expect(questions).toHaveLength(100);
      expect(questions.filter((q) => q.phase === "day1")).toHaveLength(44);
      expect(questions.filter((q) => q.phase === "day2")).toHaveLength(56);
      expect(questions.find((q) => q.phase === "day1" && q.number === 44)?.subject.id).toBe("chemistry");
      expect(questions.find((q) => q.phase === "day2" && q.number === 45)?.subject.id).toBe("english");
    }
  });
'''
new_block = '''  it("gera as sessões sem misturar numeração", () => {
    for (const year of espcexYears().filter((year) => year >= 2012)) {
      const questions = espcexQuestions(year);
      expect(questions).toHaveLength(100);
      expect(questions.filter((q) => q.phase === "day1")).toHaveLength(44);
      expect(questions.filter((q) => q.phase === "day2")).toHaveLength(56);
    }

    const q11 = espcexQuestions(2011);
    expect(q11).toHaveLength(145);
    expect(q11.filter((q) => q.phase === "day1")).toHaveLength(30);
    expect(q11.filter((q) => q.phase === "day2")).toHaveLength(30);
    expect(q11.filter((q) => q.phase === "day3")).toHaveLength(40);
    expect(q11.filter((q) => q.phase === "day4")).toHaveLength(45);
    expect(q11.find((q) => q.phase === "day3" && q.number === 21)?.subject.id).toBe("chemistry");
    expect(q11.find((q) => q.phase === "day4" && q.number === 31)?.subject.id).toBe("english");
  });
'''
if old_block not in text:
    raise RuntimeError("espcex.test: two-day block missing")
text = text.replace(old_block, new_block, 1)
text = text.replace(
    '  it("não chama caderno espelhado de oficial", () => {\n',
    '  it("não chama caderno espelhado de oficial", () => {\n    const q11 = espcexQuestions(2011)[0];\n    expect(q11.statementAvailable).toBe(false);\n    expect(q11.official?.official).toBe(false);\n    expect(q11.official?.documentUrl).toContain("zyrosite.com");\n\n',
    1,
)
text = text.replace(
    '    expect(espcexQuestionKey(espcexQuestions(2012)[0])).toBe("espcex-2012-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2012)[0])).toBe("espcex-2012-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2011).find((q) => q.phase === "day4")!)).toBe("espcex-2011-day4-1");\n',
    1,
)
text = text.replace(
    '    expect(await espcexProvider.fetchQuestions({ year: 2012 })).toHaveLength(100);\n    expect(await espcexProvider.fetchQuestions({ year: 2011 })).toEqual([]);\n',
    '    expect(await espcexProvider.fetchQuestions({ year: 2012 })).toHaveLength(100);\n    expect(await espcexProvider.fetchQuestions({ year: 2011 })).toHaveLength(145);\n    expect(await espcexProvider.fetchQuestions({ year: 2010 })).toEqual([]);\n',
    1,
)
test.write_text(text, encoding="utf-8")

# Source registry tests and historical provenance.
replace_once(
    "src/lib/sources/sources.test.ts",
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012],
    });
''',
    '''      rightsStatus: "official-reference",
      years: [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011],
    });
''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2012, "day2").official).toBe(false);\n',
    '    expect(espcexImporter.provenanceFor(2012, "day2").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2011, "day3").official).toBe(false);\n    expect(espcexImporter.provenanceFor(2011, "day4").documentUrl).toContain("zyrosite.com");\n',
)

# Audit exact 2011 cadernos and the four-page combined answer key.
audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2-verification-mirror",
        url: "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2012/2012-gabarito-matematica-geo-his-ing.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2-verification-mirror",
        url: "https://www.cursosazambuja.com.br/storage/app/media/PROVA%20E%20GABARITOS/EsPCEx/2012/2012-gabarito-matematica-geo-his-ing.pdf",
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2011-modelo-a-matematica-1-m2W1n1Wa3qCVygD9.pdf",
        informativo: true,
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2011-modelo-d-portugues-e-redacao-YD0rer93lBuVlL8o.pdf",
        informativo: true,
      },
      {
        role: "objective-exam-day3-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2011-modelo-g-fisica-e-quimica-Yg27v7GrkyuJ3X1o.pdf",
        informativo: true,
      },
      {
        role: "objective-exam-day4-mirror",
        url: "https://assets.zyrosite.com/YD0ryggN57CPDMzv/2011-modelo-j-geografia-historia-e-ingles-YZ9MZM4qn2SPK89b.pdf",
        informativo: true,
      },
      {
        role: "answer-key-all-days-mirror",
        url: "https://arquivos.qconcursos.com/prova/arquivo_gabarito/26125/exercito-2011-espcex-cadete-do-exercito-3-dia-gabarito.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2012 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação/Azambuja | `pdf-reference` | referência externa quando espelhado | 2012–2025 (2 dias); 2011 requer fases históricas |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/LAPAN/Específico/ZeroUm/Indagação/Azambuja/QConcursos | `pdf-reference` | referência externa quando espelhado | 2011–2025; 2011 em 4 sessões |",
)
