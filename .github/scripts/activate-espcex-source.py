from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Source registry.
replace_once(
    "src/lib/sources/index.ts",
    'import { epcarAnswerKey, epcarYears } from "../providers/epcar";\n',
    'import { epcarAnswerKey, epcarYears } from "../providers/epcar";\n'
    'import { espcexExamUrl, espcexYears } from "../providers/espcex";\n',
)
replace_once(
    "src/lib/sources/index.ts",
    'const FAB_PARSER = "fab-answer-key@2.1.0";\n',
    'const FAB_PARSER = "fab-answer-key@2.1.0";\n'
    'const ESPCEX_PARSER = "espcex-answer-key@1.0.0";\n',
)

source_def = '''/** EsPCEx: concurso de admissão em dois dias, mantido em modo referência. */
export const espcexSource: ExamSourceDefinition = {
  id: "espcex-official-archive",
  providerId: "espcex",
  institution: "EsPCEx",
  archiveUrl: "https://espcex.eb.mil.br/",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "active",
  family: "army",
  discovery: "manual",
  years: espcexYears(),
  phases: ["day1", "day2"],
  subjects: ["portuguese", "physics", "chemistry", "mathematics", "geography", "history", "english"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: ESPCEX_PARSER,
  lastVerifiedAt: "2026-09-11",
  confidence: "alta",
  notes:
    "Entra 2025 completo: 44 questões objetivas no 1º dia e 56 no 2º. " +
    "Os cadernos e gabaritos finais têm URLs oficiais da EsPCEx; o servidor oficial " +
    "rejeita clientes automatizados neste ambiente, então a transcrição do gabarito " +
    "foi conferida também contra uma cópia pública datada de 13/10/2025. " +
    "O enunciado não é redistribuído pelo app: permanece no documento oficial.",
};

'''
replace_once(
    "src/lib/sources/index.ts",
    "/** UNICAMP: arquivo oficial da COMVEST, 1ª fase objetiva em modo referência. */",
    source_def + "/** UNICAMP: arquivo oficial da COMVEST, 1ª fase objetiva em modo referência. */",
)
replace_once(
    "src/lib/sources/index.ts",
    "  [epcarSource.id, epcarSource],\n",
    "  [epcarSource.id, epcarSource],\n  [espcexSource.id, espcexSource],\n",
)

importer = '''export const espcexImporter: ExamImporter = {
  sourceId: espcexSource.id,
  availableYears: () => espcexYears(),
  provenanceFor(year, phase = "day1", page) {
    const selectedPhase = phase === "day2" ? "day2" : "day1";
    const url = espcexExamUrl(year, selectedPhase) ?? espcexSource.archiveUrl;
    return provenance(espcexSource, url, page);
  },
};

'''
replace_once(
    "src/lib/sources/index.ts",
    "export const unicampImporter: ExamImporter = {",
    importer + "export const unicampImporter: ExamImporter = {",
)
replace_once(
    "src/lib/sources/index.ts",
    '  if (providerId === "epcar") return epcarImporter;\n',
    '  if (providerId === "epcar") return epcarImporter;\n  if (providerId === "espcex") return espcexImporter;\n',
)

# Catalog: the two days have different sizes, so catalogue each separately.
replace_once(
    "src/lib/catalog/current.ts",
    "  epcarAnswerKey,\n  EPCAR_PROVIDER_ID,\n",
    "  epcarAnswerKey,\n  EPCAR_PROVIDER_ID,\n  espcexAnswerKey,\n  ESPCEX_PROVIDER_ID,\n",
)
espcex_catalog = '''    if (p.id === ESPCEX_PROVIDER_ID) {
      for (const ano of p.metadata.years) {
        const key = espcexAnswerKey(ano);
        if (!key) continue;
        for (const phase of ["day1", "day2"] as const) {
          const day = key.days[phase];
          entradas.push({
            providerId: p.id,
            editionId: `${ano}-${phase}`,
            year: ano,
            phase,
            questionCount: day.total,
            subjects: Object.fromEntries(
              Object.entries(day.subjects).map(([name, numbers]) => [name, numbers.length]),
            ),
            validation: NIVEL_HERDADO,
            sourceId: fonte.id,
            statementAvailable: false,
            importerVersion: fonte.parserVersion,
          });
        }
      }
      continue;
    }

'''
replace_once(
    "src/lib/catalog/current.ts",
    "    if (p.id === UDESC_PROVIDER_ID || p.id === ACAFE_PROVIDER_ID) {",
    espcex_catalog + "    if (p.id === UDESC_PROVIDER_ID || p.id === ACAFE_PROVIDER_ID) {",
)

# Source tests.
replace_once(
    "src/lib/sources/sources.test.ts",
    "  epcarImporter,\n  epcarSource,\n",
    "  epcarImporter,\n  epcarSource,\n  espcexImporter,\n  espcexSource,\n",
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '      "epcar-official-archive",\n',
    '      "epcar-official-archive",\n      "espcex-official-archive",\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(sourcesForProvider("epcar").map((s) => s.id)).toEqual(["epcar-official-archive"]);\n',
    '    expect(sourcesForProvider("epcar").map((s) => s.id)).toEqual(["epcar-official-archive"]);\n'
    '    expect(sourcesForProvider("espcex").map((s) => s.id)).toEqual(["espcex-official-archive"]);\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(importerForProvider("epcar")?.sourceId).toBe("epcar-official-archive");\n',
    '    expect(importerForProvider("epcar")?.sourceId).toBe("epcar-official-archive");\n'
    '    expect(importerForProvider("espcex")?.sourceId).toBe("espcex-official-archive");\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    "    expect(epcarImporter.availableYears()).toEqual(epcarSource.years);\n",
    "    expect(epcarImporter.availableYears()).toEqual(epcarSource.years);\n"
    "    expect(espcexImporter.availableYears()).toEqual(espcexSource.years);\n",
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(epcarImporter.provenanceFor(2025).documentUrl).toContain("cpcar2025_gab_oficial.pdf");\n',
    '    expect(epcarImporter.provenanceFor(2025).documentUrl).toContain("cpcar2025_gab_oficial.pdf");\n'
    '    expect(espcexImporter.provenanceFor(2025, "day1").documentUrl).toContain("espcex.eb.mil.br");\n'
    '    expect(espcexImporter.provenanceFor(2025, "day2").documentUrl).toContain("MODELO%20D.pdf");\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '  it("descreve os novos vestibulares aceitos como referência oficial", () => {',
    '''  it("descreve a EsPCEx como referência oficial do Exército", () => {
    expect(espcexSource).toMatchObject({
      providerId: "espcex",
      institution: "EsPCEx",
      statementMode: "reference-only",
      sourceType: "pdf-reference",
      family: "army",
      status: "active",
      rightsStatus: "official-reference",
      years: [2025],
    });
  });

  it("descreve os novos vestibulares aceitos como referência oficial", () => {''',
)

# Documentation.
replace_once(
    "docs/exam-sources.md",
    "Placeholders conceituais para o futuro — **não implementados**: EEAR,\nUFPR, EsPCEx, ESA.",
    "Placeholders conceituais para o futuro — **não implementados**: EEAR,\nUFPR, ESA.",
)
replace_once(
    "docs/exam-sources.md",
    "| EPCAR | FAB, gabaritos recuperados do Internet Archive | `pdf-reference` | não extraído | 2018–2025 |\n",
    "| EPCAR | FAB, gabaritos recuperados do Internet Archive | `pdf-reference` | não extraído | 2018–2025 |\n"
    "| EsPCEx | `espcex.eb.mil.br` | `pdf-reference` | na fonte oficial | 2025 (2 dias) |\n",
)
