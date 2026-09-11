from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, got {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Keep the explicit registry assertion in the ITA test current.
replace_once(
    "src/lib/providers/ita/ita.test.ts",
    '  it("tem as doze provas registradas, e nada além disso", () => {',
    '  it("tem as treze provas registradas, e nada além disso", () => {',
)
replace_once(
    "src/lib/providers/ita/ita.test.ts",
    '      "epcar",\n      "espcex",\n',
    '      "epcar",\n      "esa",\n      "espcex",\n',
)

# Source registry.
replace_once(
    "src/lib/sources/index.ts",
    'import { espcexExamUrl, espcexYears } from "../providers/espcex";\n',
    'import { espcexExamUrl, espcexYears } from "../providers/espcex";\n'
    'import { esaExamUrl, esaYears } from "../providers/esa";\n',
)
replace_once(
    "src/lib/sources/index.ts",
    'const ESPCEX_PARSER = "espcex-answer-key@1.0.0";\n',
    'const ESPCEX_PARSER = "espcex-answer-key@1.0.0";\n'
    'const ESA_PARSER = "esa-answer-key@1.0.0";\n',
)

source_def = '''/** ESA: Área Geral, Tipo A, mantida em modo referência. */
export const esaSource: ExamSourceDefinition = {
  id: "esa-general-reference",
  providerId: "esa",
  institution: "Escola de Sargentos das Armas",
  archiveUrl: "http://www.esa.eb.mil.br",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "permission-required",
  status: "active",
  family: "army",
  discovery: "manual",
  years: esaYears(),
  phases: ["single"],
  subjects: ["mathematics", "portuguese", "history_geography", "english"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: ESA_PARSER,
  lastVerifiedAt: "2026-09-11",
  confidence: "media",
  notes:
    "Entra somente a Área Geral de 2025, Tipo A: 50 questões objetivas e redação. " +
    "O caderno identifica a ESA e informa esa.eb.mil.br como local oficial do gabarito; " +
    "os bytes verificáveis usados pelo app vêm de espelhos públicos QConcursos/HDO. " +
    "Por isso o app não marca a URL espelhada como oficial e não redistribui o PDF.",
};

'''
replace_once(
    "src/lib/sources/index.ts",
    "/** UNICAMP: arquivo oficial da COMVEST, 1ª fase objetiva em modo referência. */",
    source_def + "/** UNICAMP: arquivo oficial da COMVEST, 1ª fase objetiva em modo referência. */",
)
replace_once(
    "src/lib/sources/index.ts",
    "  [espcexSource.id, espcexSource],\n",
    "  [espcexSource.id, espcexSource],\n  [esaSource.id, esaSource],\n",
)

importer = '''export const esaImporter: ExamImporter = {
  sourceId: esaSource.id,
  availableYears: () => esaYears(),
  provenanceFor(year, phase = "single", page) {
    const url = phase === "single" ? esaExamUrl(year) : null;
    return { ...provenance(esaSource, url ?? esaSource.archiveUrl, page), official: false };
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
    '  if (providerId === "espcex") return espcexImporter;\n',
    '  if (providerId === "espcex") return espcexImporter;\n  if (providerId === "esa") return esaImporter;\n',
)

# Catalog: one 50-question Area Geral edition.
replace_once(
    "src/lib/catalog/current.ts",
    "  espcexAnswerKey,\n  ESPCEX_PROVIDER_ID,\n",
    "  espcexAnswerKey,\n  ESPCEX_PROVIDER_ID,\n  esaAnswerKey,\n  ESA_PROVIDER_ID,\n",
)
esa_measure = '''  if (providerId === ESA_PROVIDER_ID) {
    const k = esaAnswerKey(ano);
    if (!k) return null;
    return {
      total: k.total,
      subjects: Object.fromEntries(
        Object.entries(k.subjects).map(([name, range]) => [name, range[1] - range[0] + 1]),
      ),
    };
  }

'''
replace_once(
    "src/lib/catalog/current.ts",
    "  if (providerId === UNICAMP_PROVIDER_ID) {",
    esa_measure + "  if (providerId === UNICAMP_PROVIDER_ID) {",
)

# Source tests.
replace_once(
    "src/lib/sources/sources.test.ts",
    "  espcexImporter,\n  espcexSource,\n",
    "  espcexImporter,\n  espcexSource,\n  esaImporter,\n  esaSource,\n",
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '      "espcex-official-archive",\n',
    '      "esa-general-reference",\n      "espcex-official-archive",\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(sourcesForProvider("espcex").map((s) => s.id)).toEqual(["espcex-official-archive"]);\n',
    '    expect(sourcesForProvider("espcex").map((s) => s.id)).toEqual(["espcex-official-archive"]);\n'
    '    expect(sourcesForProvider("esa").map((s) => s.id)).toEqual(["esa-general-reference"]);\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '  it("descreve os novos vestibulares aceitos como referência oficial", () => {',
    '''  it("descreve a ESA Geral como referência espelhada sem fingir URL oficial", () => {
    expect(esaSource).toMatchObject({
      providerId: "esa",
      institution: "Escola de Sargentos das Armas",
      statementMode: "reference-only",
      sourceType: "pdf-reference",
      family: "army",
      status: "active",
      rightsStatus: "permission-required",
      years: [2025],
    });
  });

  it("descreve os novos vestibulares aceitos como referência oficial", () => {''',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(importerForProvider("espcex")?.sourceId).toBe("espcex-official-archive");\n',
    '    expect(importerForProvider("espcex")?.sourceId).toBe("espcex-official-archive");\n'
    '    expect(importerForProvider("esa")?.sourceId).toBe("esa-general-reference");\n',
)
replace_once(
    "src/lib/sources/sources.test.ts",
    "    expect(espcexImporter.availableYears()).toEqual(espcexSource.years);\n",
    "    expect(espcexImporter.availableYears()).toEqual(espcexSource.years);\n"
    "    expect(esaImporter.availableYears()).toEqual(esaSource.years);\n",
)
replace_once(
    "src/lib/sources/sources.test.ts",
    '    expect(espcexImporter.provenanceFor(2025, "day2").documentUrl).toContain("MODELO%20D.pdf");\n',
    '    expect(espcexImporter.provenanceFor(2025, "day2").documentUrl).toContain("MODELO%20D.pdf");\n'
    '    expect(esaImporter.provenanceFor(2025).documentUrl).toContain("arquivos.qconcursos.com");\n'
    '    expect(esaImporter.provenanceFor(2025).official).toBe(false);\n',
)

# Source audit uses the two mirror URLs that the runner can actually verify.
audit = Path("scripts/sources-audit.mjs")
audit_text = audit.read_text(encoding="utf-8")
audit_anchor = '''  {
    providerId: "espcex",
    sourceId: "espcex-official-archive",
'''
audit_entry = '''  {
    providerId: "esa",
    sourceId: "esa-general-reference",
    archiveUrl: "http://www.esa.eb.mil.br",
    documentos: [
      {
        role: "objective-exam",
        url: "https://arquivos.qconcursos.com/prova/arquivo_prova/139039/exercito-2025-essa-sargento-geral-prova.pdf",
      },
      {
        role: "answer-key",
        url: "https://arquivos.qconcursos.com/prova/arquivo_gabarito/139039/exercito-2025-essa-sargento-geral-gabarito.pdf",
      },
    ],
  },
  {
    providerId: "espcex",
    sourceId: "espcex-official-archive",
'''
if audit_text.count(audit_anchor) != 1:
    raise RuntimeError("sources-audit: EsPCEx anchor not unique")
audit.write_text(audit_text.replace(audit_anchor, audit_entry, 1), encoding="utf-8")

# Documentation.
replace_once(
    "docs/exam-sources.md",
    "| EsPCEx | `espcex.eb.mil.br` | `pdf-reference` | na fonte oficial | 2025 (2 dias) |\n",
    "| EsPCEx | `espcex.eb.mil.br` | `pdf-reference` | na fonte oficial | 2025 (2 dias) |\n"
    "| ESA — Área Geral | documentos ESA via espelhos QConcursos/HDO; arquivo `esa.eb.mil.br` | `pdf-reference` | referência externa | 2025 Tipo A |\n",
)
replace_once(
    "docs/exam-sources.md",
    "Placeholders conceituais para o futuro — **não implementados**: EEAR,\nUFPR, ESA. Cada um exige repetir o passo 2 antes de qualquer\nestimativa.",
    "Placeholders conceituais para o futuro — **não implementados**: EEAR e\nUFPR. Cada um exige repetir o passo 2 antes de qualquer estimativa.",
)
