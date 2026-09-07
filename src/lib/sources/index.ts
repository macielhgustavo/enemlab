// Registry de fontes de prova.
import { itaYears, itaFirstPhaseUrl, itaSecondPhaseUrls } from "../providers/ita";
import { imeYears, imeExamUrl, imeAnswerKeyUrl, imeEditionOfYear } from "../providers/ime";
import { fuvestYears, fuvestExamUrl, fuvestSecondPhaseUrls } from "../providers/fuvest";
import { afaAnswerKey, afaYears } from "../providers/afa";
import { epcarAnswerKey, epcarYears } from "../providers/epcar";
import { examYears } from "../domain/constants";
import type { ExamImporter, ExamSourceDefinition, Provenance } from "./types";

export * from "./types";

const ITA_PARSER = "ita-answer-key@1.0.0";
const ENEM_PARSER = "enem-dev-api@1.0.0";
const IME_PARSER = "ime-answer-key@1.0.0";
const FUVEST_PARSER = "fuvest-answer-key@1.0.0";
const FAB_PARSER = "fab-answer-key@1.0.0";

/**
 * ENEM: API estruturada, com enunciado e alternativas em texto.
 */
export const enemSource: ExamSourceDefinition = {
  id: "enem-dev",
  providerId: "enem",
  institution: "INEP",
  archiveUrl: "https://api.enem.dev",
  sourceType: "structured-api",
  statementMode: "structured",
  extractionMethod: "api",
  rightsStatus: "allowed",
  family: "general",
  years: examYears(),
  phases: ["day1", "day2"],
  subjects: ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: ENEM_PARSER,
  lastVerifiedAt: "2026-09-05",
  confidence: "alta",
  discovery: "manual",
  notes: "Provas do INEP são de acesso público e a API entrega conteúdo estruturado.",
};

/**
 * ITA: arquivo oficial em PDF. As provas são digitalizadas (verificado: 0
 * caractere de texto, uma imagem por página), então o enunciado permanece na
 * fonte. Só o gabarito é ingerido, por ter camada de texto e ser dado factual.
 */
export const itaSource: ExamSourceDefinition = {
  id: "ita-official-archive",
  providerId: "ita",
  institution: "ITA",
  archiveUrl: "https://www.vestibular.ita.br/provas.htm",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  family: "engineering",
  years: itaYears(),
  phases: ["first", "second"],
  subjects: ["mathematics", "physics", "chemistry", "portuguese", "english"],
  answerKeyAvailable: true,
  // O ITA não publica resolução oficial estruturada da 2ª fase.
  expectedAnswersAvailable: false,
  parserVersion: ITA_PARSER,
  lastVerifiedAt: "2026-09-05",
  confidence: "alta",
  discovery: "manual",
  notes:
    "Enunciado não é reproduzido: é consultado no PDF oficial. Edições até 2018 " +
    "numeram por matéria e foram recusadas pela ingestão.",
};

/**
 * ENEM, arquivo oficial do INEP — **segunda fonte da mesma prova**.
 *
 * É o caso que o §15 pede provar: um provider com mais de uma fonte. A API
 * estruturada entrega enunciado em texto e vai de 2009 a 2023; o arquivo do
 * INEP cobre 1998 a 2025, mas em PDF.
 *
 * A regra é não trocar fonte boa por PDF pior. A estruturada continua sendo
 * a origem de 2009–2023; o INEP entra para o que ela não tem.
 *
 * Ainda **não ingerida**, e o motivo é concreto: o ENEM aplica vários
 * cadernos por dia (Azul, Amarelo, Branco, Rosa), que são a mesma prova em
 * ordem diferente. São 95 documentos só em 2025. Importar isso sem modelar
 * variante criaria quatro cópias de cada questão e um gabarito corrigindo o
 * caderno errado — o problema de `ExamVariant` que o escopo levanta no §19.
 *
 * A descoberta também não é trivial: a página do INEP monta a lista por
 * JavaScript, e o HTML servido tem zero link de PDF. As URLs seguem
 * `{ano}_{PV|GB}_impresso_D{dia}_CD{caderno}.pdf` — conferido em 2023, 2024
 * e 2025 —, mas §14 é explícito: não inferir arquivo por padrão de URL sem
 * verificar existência.
 */
export const enemOfficialSource: ExamSourceDefinition = {
  id: "inep-official-archive",
  providerId: "enem",
  institution: "INEP",
  archiveUrl:
    "https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem/provas-e-gabaritos",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  family: "general",
  // A página exige JavaScript para listar; descoberta automática por HTTP
  // simples não funciona aqui.
  discovery: "manual",
  // Vazio de propósito: nenhuma edição foi ingerida por esta fonte ainda.
  // Declarar 1998–2025 aqui faria o app prometer prova que não tem.
  years: [],
  phases: ["day1", "day2"],
  subjects: ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "inep-archive@0.0.0-nao-ingerido",
  lastVerifiedAt: "2026-09-06",
  confidence: "media",
  notes:
    "Registrada, não ingerida. Cobre 1998–2025 e é o único caminho para 2024 " +
    "e 2025, que a API estruturada não tem. Exige modelar caderno como " +
    "variante antes de qualquer importação.",
};

/**
 * IME: arquivo oficial do Concurso de Admissão ao CFG.
 *
 * `reference-only` por um motivo diferente do ITA, e a diferença importa
 * para quem adicionar a próxima prova. O ITA é digitalizado — não há texto.
 * O IME **tem** camada de texto, mas ela quebra a matemática: 67 frações
 * saem em três linhas e expoentes viram dígitos comuns, então a fórmula
 * mostrada seria diferente da que caiu na prova.
 *
 * "O PDF tem texto" não basta para decidir. O que decide é se o texto
 * preserva o significado.
 */
export const imeSource: ExamSourceDefinition = {
  id: "ime-cfg-archive",
  providerId: "ime",
  institution: "IME",
  archiveUrl:
    "https://www.ime.eb.mil.br/vestibular-e-concursos/cfg-ensino-medio/provas-anteriores-cfg",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  family: "engineering",
  discovery: "automatic",
  years: imeYears(),
  // A discursiva e a prova de línguas existem no arquivo e estão declaradas
  // aqui, mas não são executáveis: não há correção de discursiva, e
  // inventar uma seria pior que não ter.
  phases: ["first", "second"],
  subjects: ["mathematics", "physics", "chemistry"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: IME_PARSER,
  lastVerifiedAt: "2026-09-06",
  confidence: "alta",
  notes:
    "Objetiva com 40 questões (15 matemática, 15 física, 10 química) em todas " +
    "as oito edições ingeridas. O gabarito publicado é o final/definitivo. " +
    "Discursiva e línguas ficam como referência.",
};

/**
 * FUVEST: acervo oficial do vestibular.
 *
 * Primeira prova do catálogo com **variantes**. A FUVEST aplica a mesma
 * prova em várias versões reordenadas e publica um gabarito único com todas
 * em colunas — quatro versões em 2025 (V1..V4), cinco em 2024 (V, K, Q, X,
 * Z). O importador lê os nomes do documento; fixá-los no código faria o
 * parser recusar todo ano em que a banca mudasse a nomenclatura, ou pior,
 * atribuir a resposta à versão errada.
 *
 * `years` traz só as edições que o importador leu inteiras. Das 27
 * descobertas no acervo, 23 são recusadas: as mais antigas usam layout
 * diferente ou não publicam o gabarito da 1ª fase como documento próprio.
 * Recusar é o comportamento correto — meia leitura corrige errado.
 */
export const fuvestSource: ExamSourceDefinition = {
  id: "fuvest-archive",
  providerId: "fuvest",
  institution: "FUVEST",
  archiveUrl: "https://www.fuvest.br/acervo-vestibular",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  family: "university",
  discovery: "automatic",
  years: fuvestYears(),
  // A 2ª fase é discursiva: registrada, não executável.
  phases: ["first", "second"],
  subjects: ["conhecimentos-gerais"],
  answerKeyAvailable: true,
  // A FUVEST publica respostas esperadas da 2ª fase, mas não há corretor
  // discursivo — declarar disponibilidade prometeria correção que não existe.
  expectedAnswersAvailable: false,
  parserVersion: FUVEST_PARSER,
  lastVerifiedAt: "2026-09-07",
  confidence: "alta",
  notes:
    "1ª fase com 90 questões. Só as edições cujo gabarito foi lido por " +
    "inteiro entram; o acervo tem 27 edições e 23 são recusadas por formato " +
    "antigo. Versões são reordenação: só a canônica vira questão.",
};

/**
 * AFA: arquivo oficial da FAB, em modo referência.
 *
 * O gabarito final da versão A é dado factual e foi conferido por edição.
 * Os PDFs da prova permanecem na FAB: a extração não é distribuída como
 * texto porque fórmulas, diagramas e paginação não foram validados para cópia.
 */
export const afaSource: ExamSourceDefinition = {
  id: "afa-official-archive",
  providerId: "afa",
  institution: "FAB",
  archiveUrl: "https://www.fab.mil.br/ingresso/provas.html",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "air-force",
  discovery: "automatic",
  years: afaYears(),
  phases: ["first"],
  subjects: ["portuguese", "mathematics", "english", "physics"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: FAB_PARSER,
  lastVerifiedAt: "2026-09-07",
  confidence: "media",
  notes:
    "A FAB publica AFA 2018–2026. Entram somente 2019–2026, com gabarito final " +
    "completo da versão A; 2018 permanece bloqueada por extração incompleta. " +
    "A prova tem 64 questões, versões A/B/C e anuladas preservadas.",
};

/** EPCAR: arquivo oficial da FAB, em modo referência. */
export const epcarSource: ExamSourceDefinition = {
  id: "epcar-official-archive",
  providerId: "epcar",
  institution: "FAB",
  archiveUrl: "https://www.fab.mil.br/ingresso/provas.html",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "air-force",
  discovery: "automatic",
  years: epcarYears(),
  phases: ["first"],
  subjects: ["english", "mathematics", "portuguese"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: FAB_PARSER,
  lastVerifiedAt: "2026-09-07",
  confidence: "media",
  notes:
    "A FAB publica EPCAR 2018–2026. Entram somente 2020, 2023 e 2025, " +
    "com gabarito final completo da versão A; as demais ficam bloqueadas até " +
    "a associação prova↔gabarito final ser comprovada sem inferência.",
};

/** UFPR pesquisada, mas deliberadamente não executável nesta wave. */
export const ufprResearchSource: ExamSourceDefinition = {
  id: "ufpr-research",
  providerId: "ufpr",
  institution: "UFPR",
  archiveUrl: "https://lua.nc.ufpr.br/PortalNC/Concurso?concurso=PS2026",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["first", "second"],
  subjects: ["general"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "ufpr-research@0.1.0",
  lastVerifiedAt: "2026-09-07",
  confidence: "baixa",
  notes:
    "PS 2018–PS 2026 foram investigados. Há provas, versões e documentos " +
    "preliminares/definitivos, mas não foi encontrada uma associação final " +
    "consistente para ingestão segura; não há parser nem provider.",
};

/** EEAR pesquisada e adiada por códigos e cursos múltiplos. */
export const eearResearchSource: ExamSourceDefinition = {
  id: "eear-research",
  providerId: "eear",
  institution: "FAB",
  archiveUrl: "https://ingresso.eear.fab.mil.br/SOO/home/provas_anteriores.php?sigla_conc=%25",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "blocked",
  family: "air-force",
  discovery: "automatic",
  years: [],
  phases: ["first"],
  subjects: ["portuguese", "mathematics", "english"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "eear-research@0.1.0",
  lastVerifiedAt: "2026-09-07",
  confidence: "baixa",
  notes:
    "O arquivo oficial tem vários cursos, anos, códigos e opções de prova. " +
    "A associação determinística entre cada prova e seu gabarito final não " +
    "foi concluída; provider adiado para v8.5.4.",
};

const SOURCES = new Map<string, ExamSourceDefinition>([
  [enemSource.id, enemSource],
  [itaSource.id, itaSource],
  [imeSource.id, imeSource],
  [enemOfficialSource.id, enemOfficialSource],
  [fuvestSource.id, fuvestSource],
  [afaSource.id, afaSource],
  [epcarSource.id, epcarSource],
  [ufprResearchSource.id, ufprResearchSource],
  [eearResearchSource.id, eearResearchSource],
]);

export function listSources(): ExamSourceDefinition[] {
  return [...SOURCES.values()];
}

export function getSource(id: string): ExamSourceDefinition {
  const s = SOURCES.get(id);
  if (!s) throw new Error(`Fonte não registrada: ${id}`);
  return s;
}

/** Fontes que alimentam um provider. */
export function sourcesForProvider(providerId: string): ExamSourceDefinition[] {
  return listSources().filter((s) => s.providerId === providerId);
}

function provenance(src: ExamSourceDefinition, documentUrl: string, page?: number): Provenance {
  return {
    providerId: src.providerId,
    sourceId: src.id,
    institution: src.institution,
    official: src.rightsStatus !== "unknown",
    documentUrl,
    page,
    parserVersion: src.parserVersion,
    lastVerifiedAt: src.lastVerifiedAt,
  };
}

export const itaImporter: ExamImporter = {
  sourceId: itaSource.id,
  availableYears: () => itaYears(),
  provenanceFor(year, phase = "first", page) {
    // A 2ª fase é dividida por matéria; sem matéria, aponta o arquivo do ano.
    const url =
      phase === "second"
        ? (itaSecondPhaseUrls(year)[0]?.url ?? itaFirstPhaseUrl(year))
        : itaFirstPhaseUrl(year);
    return provenance(itaSource, url, page);
  },
};

export const enemImporter: ExamImporter = {
  sourceId: enemSource.id,
  availableYears: () => examYears(),
  provenanceFor(year) {
    return provenance(enemSource, `${enemSource.archiveUrl}/v1/exams/${year}/questions`);
  },
};

export const imeImporter: ExamImporter = {
  sourceId: imeSource.id,
  availableYears: () => imeYears(),
  provenanceFor(year, phase = "first", page) {
    const edicao = imeEditionOfYear(year);
    // Sem edição conhecida, a procedência aponta o arquivo da instituição —
    // nunca uma URL montada por padrão, que daria 404 ou o documento errado.
    const url =
      (edicao && (phase === "first" ? imeExamUrl(edicao) : imeAnswerKeyUrl(edicao))) ??
      imeSource.archiveUrl;
    return provenance(imeSource, url, page);
  },
};

export const fuvestImporter: ExamImporter = {
  sourceId: fuvestSource.id,
  availableYears: () => fuvestYears(),
  provenanceFor(year, phase = "first", page) {
    const url =
      (phase === "first" ? fuvestExamUrl(year) : fuvestSecondPhaseUrls(year)[0]) ??
      fuvestSource.archiveUrl;
    return provenance(fuvestSource, url, page);
  },
};

export const afaImporter: ExamImporter = {
  sourceId: afaSource.id,
  availableYears: () => afaYears(),
  provenanceFor(year, phase = "first", page) {
    const key = afaAnswerKey(year);
    const url = phase === "first" ? key?.examUrl ?? key?.answerKeyUrl : afaSource.archiveUrl;
    return provenance(afaSource, url ?? afaSource.archiveUrl, page);
  },
};

export const epcarImporter: ExamImporter = {
  sourceId: epcarSource.id,
  availableYears: () => epcarYears(),
  provenanceFor(year, phase = "first", page) {
    const key = epcarAnswerKey(year);
    const url = phase === "first" ? key?.examUrl ?? key?.answerKeyUrl : epcarSource.archiveUrl;
    return provenance(epcarSource, url ?? epcarSource.archiveUrl, page);
  },
};

export function importerForProvider(providerId: string): ExamImporter | null {
  if (providerId === "ita") return itaImporter;
  if (providerId === "enem") return enemImporter;
  if (providerId === "ime") return imeImporter;
  if (providerId === "fuvest") return fuvestImporter;
  if (providerId === "afa") return afaImporter;
  if (providerId === "epcar") return epcarImporter;
  return null;
}
