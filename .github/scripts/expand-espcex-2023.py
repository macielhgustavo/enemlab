import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


path = Path("src/lib/providers/espcex/answer-keys.generated.json")
data = json.loads(path.read_text(encoding="utf-8"))
if "2023" in data:
    raise RuntimeError("EsPCEx 2023 already exists")
data["2023"] = {
    "year": 2023,
    "revision": "mirror-reviewed-2023",
    "parserVersion": "espcex-answer-key@1.0.0",
    "days": {
        "day1": {
            "model": "A",
            "total": 44,
            "examUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/provas/2023-modelo-a-1-dia-de-prova.pdf",
            "examOfficial": False,
            "answerKeyUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/gabarito/2023-gabarito-1-dia-de-prova.pdf",
            "verificationUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/provas-e-gabaritos/preparatorio-espcex/",
            "annulled": [],
            "subjects": {
                "portuguese": list(range(1, 21)),
                "physics": list(range(21, 33)),
                "chemistry": list(range(33, 45)),
            },
            "answers": {
                "1":"D","2":"C","3":"E","4":"D","5":"A","6":"B","7":"A","8":"A","9":"C","10":"A",
                "11":"D","12":"B","13":"B","14":"E","15":"D","16":"C","17":"A","18":"B","19":"C","20":"E",
                "21":"A","22":"E","23":"D","24":"A","25":"C","26":"A","27":"B","28":"D","29":"E","30":"B","31":"B","32":"C",
                "33":"A","34":"D","35":"C","36":"B","37":"B","38":"D","39":"B","40":"E","41":"D","42":"A","43":"E","44":"C",
            },
        },
        "day2": {
            "model": "D",
            "total": 56,
            "examUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/provas/2023-modelo-d-2-dia-de-prova.pdf",
            "examOfficial": False,
            "answerKeyUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/gabarito/2023-gabarito-2-dia-de-prova.pdf",
            "verificationUrl": "https://hdocurso.com.br/cursos-preparatorios-militares/provas-e-gabaritos/preparatorio-espcex/",
            "annulled": [],
            "subjects": {
                "mathematics": list(range(1, 21)),
                "geography": list(range(21, 33)),
                "history": list(range(33, 45)),
                "english": list(range(45, 57)),
            },
            "answers": {
                "1":"C","2":"E","3":"D","4":"B","5":"C","6":"A","7":"C","8":"E","9":"B","10":"B",
                "11":"C","12":"E","13":"D","14":"A","15":"B","16":"D","17":"E","18":"A","19":"B","20":"C",
                "21":"A","22":"D","23":"B","24":"B","25":"C","26":"E","27":"D","28":"C","29":"E","30":"A","31":"B","32":"C",
                "33":"B","34":"A","35":"D","36":"C","37":"A","38":"D","39":"E","40":"E","41":"B","42":"B","43":"E","44":"C",
                "45":"D","46":"E","47":"A","48":"C","49":"B","50":"E","51":"D","52":"B","53":"D","54":"C","55":"A","56":"E",
            },
        },
    },
}
data = dict(sorted(data.items(), key=lambda item: int(item[0])))
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Expose whether the actual exam document is institution-owned or a mirror.
replace_once(
    "src/lib/providers/espcex/index.ts",
    '''export function espcexExamUrl(year: number, phase: "day1" | "day2"): string | null {
  return espcexAnswerKey(year)?.days[phase].examUrl ?? null;
}

''',
    '''export function espcexExamUrl(year: number, phase: "day1" | "day2"): string | null {
  return espcexAnswerKey(year)?.days[phase].examUrl ?? null;
}

export function espcexExamOfficial(year: number, phase: "day1" | "day2"): boolean {
  const day = espcexAnswerKey(year)?.days[phase];
  return day ? (day.examOfficial ?? true) : false;
}

''',
)

# Provider tests: generic coverage already validates the full answer maps.
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    expect(espcexYears()).toEqual([2025, 2024]);\n",
    "    expect(espcexYears()).toEqual([2025, 2024, 2023]);\n",
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    "    const k24 = espcexAnswerKey(2024)!;\n",
    '''    const k23 = espcexAnswerKey(2023)!;
    expect(k23.revision).toBe("mirror-reviewed-2023");
    expect(k23.days.day1.model).toBe("A");
    expect(k23.days.day2.model).toBe("D");
    expect(k23.days.day1.total).toBe(44);
    expect(k23.days.day2.total).toBe(56);

    const k24 = espcexAnswerKey(2024)!;
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    const q24 = espcexQuestions(2024)[0];
    expect(q24.statementAvailable).toBe(false);
''',
    '''    const q23 = espcexQuestions(2023)[0];
    expect(q23.statementAvailable).toBe(false);
    expect(q23.official?.official).toBe(false);
    expect(q23.official?.documentUrl).toContain("hdocurso.com.br");

    const q24 = espcexQuestions(2024)[0];
    expect(q24.statementAvailable).toBe(false);
''',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '    expect(espcexQuestionKey(espcexQuestions(2024)[0])).toBe("espcex-2024-day1-1");\n',
    '    expect(espcexQuestionKey(espcexQuestions(2024)[0])).toBe("espcex-2024-day1-1");\n    expect(espcexQuestionKey(espcexQuestions(2023)[0])).toBe("espcex-2023-day1-1");\n',
)
replace_once(
    "src/lib/providers/espcex/espcex.test.ts",
    '''    expect(await espcexProvider.fetchQuestions({ year: 2024 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2023 })).toEqual([]);
''',
    '''    expect(await espcexProvider.fetchQuestions({ year: 2024 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2023 })).toHaveLength(100);
    expect(await espcexProvider.fetchQuestions({ year: 2022 })).toEqual([]);
''',
)

# Source importer must not turn mirror provenance back into official=true.
replace_once(
    "src/lib/sources/index.ts",
    'import { espcexExamUrl, espcexYears } from "../providers/espcex";\n',
    'import { espcexExamOfficial, espcexExamUrl, espcexYears } from "../providers/espcex";\n',
)
replace_once(
    "src/lib/sources/index.ts",
    '''    const url = espcexExamUrl(year, selectedPhase) ?? espcexSource.archiveUrl;
    return provenance(espcexSource, url, page);
''',
    '''    const url = espcexExamUrl(year, selectedPhase) ?? espcexSource.archiveUrl;
    return {
      ...provenance(espcexSource, url, page),
      official: espcexExamOfficial(year, selectedPhase),
    };
''',
)
replace_once(
    "src/lib/sources/index.ts",
    '''  notes:
    "Entram 2024–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +
    "Os gabaritos finais apontam para URLs da EsPCEx. Em 2025 os cadernos também têm " +
    "URL oficial; em 2024 os cadernos verificáveis usados pelo app são espelhos públicos " +
    "e por isso as questões desse ano carregam `official: false`. O app não redistribui PDFs.",
''',
    '''  notes:
    "Entram 2023–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +
    "Em 2025 os cadernos usados pelo app têm URL oficial. Em 2023–2024 os cadernos " +
    "verificáveis são espelhos públicos, por isso essas questões e sua procedência carregam " +
    "`official: false`. Gabaritos são dados factuais e o app não redistribui PDFs.",
''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    "      years: [2025, 2024],\n",
    "      years: [2025, 2024, 2023],\n",
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '''    expect(espcexImporter.provenanceFor(2025, "day2").documentUrl).toContain("MODELO%20D.pdf");
    expect(esaImporter.provenanceFor(2025).documentUrl).toContain("arquivos.qconcursos.com");
''',
    '''    expect(espcexImporter.provenanceFor(2025, "day2").documentUrl).toContain("MODELO%20D.pdf");
    expect(espcexImporter.provenanceFor(2025, "day1").official).toBe(true);
    expect(espcexImporter.provenanceFor(2024, "day1").official).toBe(false);
    expect(espcexImporter.provenanceFor(2023, "day1").official).toBe(false);
    expect(esaImporter.provenanceFor(2025).documentUrl).toContain("arquivos.qconcursos.com");
''',
)

# Audit the same HDO mirror documents used in the dataset.
audit = Path("scripts/sources-audit.mjs")
text = audit.read_text(encoding="utf-8")
anchor = '''      {
        role: "answer-key-day2",
        url: "https://espcex.eb.mil.br/images/concurso/2024_publConcurso/gabaritos/Gabarito_2024_Dia_2_Final.pdf",
        informativo: true,
      },
    ],
  },
  {
    providerId: "ita",
'''
replacement = '''      {
        role: "answer-key-day2",
        url: "https://espcex.eb.mil.br/images/concurso/2024_publConcurso/gabaritos/Gabarito_2024_Dia_2_Final.pdf",
        informativo: true,
      },
      {
        role: "objective-exam-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/provas/2023-modelo-a-1-dia-de-prova.pdf",
      },
      {
        role: "answer-key-day1-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/gabarito/2023-gabarito-1-dia-de-prova.pdf",
      },
      {
        role: "objective-exam-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/provas/2023-modelo-d-2-dia-de-prova.pdf",
      },
      {
        role: "answer-key-day2-mirror",
        url: "https://hdocurso.com.br/cursos-preparatorios-militares/preparatorio-espcex/2023/gabarito/2023-gabarito-2-dia-de-prova.pdf",
      },
    ],
  },
  {
    providerId: "ita",
'''
if text.count(anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx 2024 anchor not unique")
audit.write_text(text.replace(anchor, replacement, 1), encoding="utf-8")

replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | gabaritos `espcex.eb.mil.br`; caderno 2024 via espelho público | `pdf-reference` | referência externa quando espelhado | 2024–2025 (2 dias) |",
    "| EsPCEx | `espcex.eb.mil.br` + espelhos HDO/Específico | `pdf-reference` | referência externa quando espelhado | 2023–2025 (2 dias) |",
)
