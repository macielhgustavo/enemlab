// Plataforma de ingestão em massa.
//
// A v8.0 formalizou FONTE → IMPORTADOR → PROVIDER com uma prova só do lado
// difícil (o ITA). Para dezenas de instituições isso não basta: falta saber
// **quais edições existem**, **se o documento mudou desde a última leitura**,
// **quanto se confia no que foi extraído** e **o que falhou**.
//
//   FONTE → DESCOBERTA → IMPORTADOR → BRUTO → VALIDADOR → CATÁLOGO → PROVIDER
//
// A regra que governa tudo aqui é a de §41 do escopo: **falhar fechado**.
// Uma edição em que 59 de 60 questões foram lidas não entra "quase certa" —
// ela é recusada. Prova pela metade produz correção errada, e correção
// errada é pior que ausência de prova.

import type { ExtractionMethod, RightsStatus, StatementMode } from "./types";

/* ------------------------------------------------------------------ *
 * Descoberta
 * ------------------------------------------------------------------ */

/**
 * Uma edição encontrada no arquivo de uma instituição.
 *
 * `editionId` é a identidade estável e legível. Algumas bancas nomeiam a
 * edição por ano civil ("2026") e outras pelo ciclo do concurso
 * ("2025-2026"); guardar a string original evita inventar uma conversão que
 * depois não bate com o site oficial.
 */
export interface DiscoveredEdition {
  editionId: string;
  /** Ano de referência para ordenação e filtro. */
  year: number;
  /** Rótulo como a instituição escreve. */
  label: string;
  documents: DiscoveredDocument[];
}

export interface DiscoveredDocument {
  /** Papel do documento dentro da edição. */
  role: DocumentRole;
  url: string;
  /** Fase a que pertence, quando o documento é específico de uma. */
  phase?: string;
  /** Matéria, quando a banca publica um caderno por matéria. */
  subject?: string;
  /**
   * Versão/caderno da prova, quando a banca aplica variantes embaralhadas.
   * Ignorar isto faz o gabarito de uma versão corrigir outra.
   */
  variant?: string;
}

export type DocumentRole =
  | "objective-exam"
  | "answer-key"
  | "answer-key-preliminary"
  | "subject-exam"
  | "expected-answers"
  | "essay"
  | "notice";

/**
 * Descobre o que existe no arquivo oficial.
 *
 * Deliberadamente separado do importador: descobrir edições é navegar um
 * site, e extrair questões é ler um documento. Juntar os dois foi o que
 * fez o ITA nascer com a lista de anos escrita à mão.
 *
 * §14 do escopo pede descoberta automática **com allowlist**: o importador
 * não deve engolir qualquer coisa que apareça no servidor.
 */
export interface ExamSourceDiscovery {
  readonly sourceId: string;
  /**
   * Lista as edições publicadas. Recebe o buscador por injeção para o teste
   * não precisar de rede — requisito de §45.
   */
  discover(fetcher: DocumentFetcher): Promise<DiscoveredEdition[]>;
  /**
   * Barreira contra conteúdo inesperado. Uma edição fora do intervalo
   * conhecido é recusada em vez de importada às cegas.
   */
  isAllowed(edition: DiscoveredEdition): boolean;
}

/** Busca um documento. Injetado para permitir teste sem rede. */
export interface DocumentFetcher {
  (url: string): Promise<FetchedDocument>;
}

export interface FetchedDocument {
  url: string;
  bytes: Uint8Array;
  headers: Record<string, string>;
}

/* ------------------------------------------------------------------ *
 * Impressão digital do documento
 * ------------------------------------------------------------------ */

/**
 * Identidade do documento no momento em que foi lido (§8).
 *
 * Existe para responder uma pergunta específica: **o documento mudou?**
 * Bancas publicam retificação sem avisar, e um gabarito corrigido depois da
 * ingestão deixaria o app corrigindo prova com a resposta antiga em
 * silêncio.
 */
export interface DocumentFingerprint {
  url: string;
  contentLength: number;
  /** SHA-256 do conteúdo baixado para processamento. */
  sha256: string;
  lastModified?: string;
  etag?: string;
  parserVersion: string;
  importedAt: string;
}

/** Como duas leituras do mesmo documento se comparam. */
export type FingerprintDiff = "identical" | "changed" | "unknown";

/**
 * Compara duas leituras.
 *
 * O hash manda. `etag` e `last-modified` são dicas do servidor e vários
 * arquivos oficiais não enviam nenhum dos dois — por isso ausência dos dois
 * lados não é prova de igualdade, é `unknown`.
 */
export function compareFingerprints(
  antes: DocumentFingerprint | undefined,
  agora: DocumentFingerprint,
): FingerprintDiff {
  if (!antes) return "unknown";
  if (antes.sha256 && agora.sha256) {
    return antes.sha256 === agora.sha256 ? "identical" : "changed";
  }
  if (antes.contentLength !== agora.contentLength) return "changed";
  return "unknown";
}

/* ------------------------------------------------------------------ *
 * Níveis de validação
 * ------------------------------------------------------------------ */

/**
 * Quanto se confia numa edição (§6).
 *
 * Não é uma nota de qualidade do conteúdo: é uma afirmação sobre **o que foi
 * conferido**. `provisional` não quer dizer "provavelmente errada", quer
 * dizer "ninguém olhou ainda".
 */
export type ValidationLevel = "verified" | "reviewed" | "provisional" | "blocked";

/** Ordem de confiança, para filtrar o que entra no banco padrão. */
const ORDEM: Record<ValidationLevel, number> = {
  verified: 3,
  reviewed: 2,
  provisional: 1,
  blocked: 0,
};

/**
 * O banco padrão usa `verified` e `reviewed` (§6).
 *
 * `provisional` fica disponível para quem escolher explicitamente; `blocked`
 * não é usado em lugar nenhum.
 */
export function usableInDefaultBank(nivel: ValidationLevel): boolean {
  return ORDEM[nivel] >= ORDEM.reviewed;
}

export function isBlocked(nivel: ValidationLevel): boolean {
  return nivel === "blocked";
}

/* ------------------------------------------------------------------ *
 * Relatório de importação
 * ------------------------------------------------------------------ */

/** Um problema encontrado durante a importação. */
export interface ImportIssue {
  code: ImportIssueCode;
  message: string;
  /** `true` quando o problema sozinho já reprova a edição. */
  fatal: boolean;
}

export type ImportIssueCode =
  | "count-mismatch"
  | "answer-key-mismatch"
  | "duplicate-number"
  | "missing-number"
  | "invalid-letter"
  | "document-changed"
  | "document-missing"
  | "preliminary-key-only"
  | "media-missing"
  | "not-allowed";

/**
 * O que aconteceu ao importar uma edição (§5).
 *
 * Existe para que ninguém publique uma edição incompleta em silêncio. O
 * relatório é dado, não texto: a CLI o imprime, o teste o inspeciona e o
 * Data Quality o exibe.
 */
export interface ImportReport {
  providerId: string;
  sourceId: string;
  editionId: string;
  importerVersion: string;
  startedAt: string;

  documentsDiscovered: number;
  documentsFetched: number;

  objectiveExpected: number;
  objectiveParsed: number;

  answerKeysExpected: number;
  answerKeysMatched: number;

  annulled: number[];
  unmatched: number[];
  duplicates: number[];

  /** Contagem por matéria, na taxonomia do próprio provider. */
  subjects: Record<string, number>;

  validation: ValidationLevel;
  issues: ImportIssue[];
}

/* ------------------------------------------------------------------ *
 * Validador
 * ------------------------------------------------------------------ */

/** O que o validador recebe para julgar uma edição. */
export interface EditionUnderValidation {
  providerId: string;
  sourceId: string;
  editionId: string;
  importerVersion: string;
  /** Números de questão efetivamente extraídos, na ordem em que apareceram. */
  parsedNumbers: number[];
  /** Total que a edição declara ter. */
  expectedCount: number;
  /** Gabarito, do número da questão para a letra. */
  answerKey: Record<number, string>;
  /** Questões anuladas: não têm gabarito e não contam como erro. */
  annulled: number[];
  /** Letras aceitas nesta prova. */
  allowedLetters: string[];
  /** Contagem por matéria. */
  subjects: Record<string, number>;
  documentsDiscovered: number;
  documentsFetched: number;
  /** `true` quando só existe gabarito preliminar (§9). */
  preliminaryKeyOnly?: boolean;
  /** Documentos cujo conteúdo mudou desde a última leitura (§8). */
  changedDocuments?: string[];
  /** Questões que dependem de mídia ausente (§12). */
  questionsMissingMedia?: number[];
}

/**
 * Julga uma edição e devolve o relatório.
 *
 * **Falha fechado.** Qualquer inconsistência estrutural — contagem, gabarito,
 * número duplicado, letra fora do conjunto — reprova a edição inteira. Nunca
 * "parece ter dado certo".
 *
 * O melhor resultado que esta função concede sozinha é `provisional`:
 * `reviewed` e `verified` exigem conferência humana, e um programa não pode
 * se declarar conferido por outra pessoa.
 */
export function validateEdition(e: EditionUnderValidation): ImportReport {
  const issues: ImportIssue[] = [];

  const numeros = e.parsedNumbers;
  const vistos = new Set<number>();
  const duplicates: number[] = [];
  for (const n of numeros) {
    if (vistos.has(n)) duplicates.push(n);
    vistos.add(n);
  }

  const esperados = Array.from({ length: e.expectedCount }, (_, i) => i + 1);
  const missing = esperados.filter((n) => !vistos.has(n));

  // Gabarito: toda questão não anulada precisa de uma letra válida.
  const semGabarito: number[] = [];
  const letraInvalida: number[] = [];
  for (const n of numeros) {
    if (e.annulled.includes(n)) continue;
    const letra = e.answerKey[n];
    if (letra === undefined) semGabarito.push(n);
    else if (!e.allowedLetters.includes(letra)) letraInvalida.push(n);
  }

  const answerKeysMatched = numeros.filter(
    (n) => e.annulled.includes(n) || e.answerKey[n] !== undefined,
  ).length;

  if (numeros.length !== e.expectedCount) {
    issues.push({
      code: "count-mismatch",
      message: `esperava ${e.expectedCount} questões, extraiu ${numeros.length}`,
      fatal: true,
    });
  }
  if (duplicates.length) {
    issues.push({
      code: "duplicate-number",
      message: `número repetido: ${duplicates.join(", ")}`,
      fatal: true,
    });
  }
  if (missing.length) {
    issues.push({
      code: "missing-number",
      message: `sem extração: ${missing.join(", ")}`,
      fatal: true,
    });
  }
  if (semGabarito.length) {
    issues.push({
      code: "answer-key-mismatch",
      message: `sem gabarito: ${semGabarito.join(", ")}`,
      fatal: true,
    });
  }
  if (letraInvalida.length) {
    issues.push({
      code: "invalid-letter",
      message: `letra fora de [${e.allowedLetters.join("")}]: ${letraInvalida.join(", ")}`,
      fatal: true,
    });
  }
  if (e.documentsFetched < e.documentsDiscovered) {
    issues.push({
      code: "document-missing",
      message: `${e.documentsDiscovered - e.documentsFetched} documento(s) não baixado(s)`,
      fatal: true,
    });
  }
  if (e.preliminaryKeyOnly) {
    // Não é fatal por si: é uma edição recém-aplicada, cujo gabarito final
    // ainda não saiu. Mas nunca pode ser dada como conferida.
    issues.push({
      code: "preliminary-key-only",
      message: "só há gabarito preliminar; o final pode retificar respostas",
      fatal: false,
    });
  }
  if (e.changedDocuments?.length) {
    issues.push({
      code: "document-changed",
      message: `documento alterado na origem: ${e.changedDocuments.join(", ")}`,
      fatal: true,
    });
  }
  if (e.questionsMissingMedia?.length) {
    issues.push({
      code: "media-missing",
      message: `questão depende de mídia ausente: ${e.questionsMissingMedia.join(", ")}`,
      fatal: false,
    });
  }

  const temFatal = issues.some((i) => i.fatal);

  return {
    providerId: e.providerId,
    sourceId: e.sourceId,
    editionId: e.editionId,
    importerVersion: e.importerVersion,
    startedAt: new Date().toISOString(),
    documentsDiscovered: e.documentsDiscovered,
    documentsFetched: e.documentsFetched,
    objectiveExpected: e.expectedCount,
    objectiveParsed: numeros.length,
    answerKeysExpected: e.expectedCount,
    answerKeysMatched,
    annulled: [...e.annulled].sort((a, b) => a - b),
    unmatched: [...semGabarito, ...missing].sort((a, b) => a - b),
    duplicates: duplicates.sort((a, b) => a - b),
    subjects: e.subjects,
    validation: temFatal ? "blocked" : "provisional",
    issues,
  };
}

/** Texto do relatório, no formato que a CLI imprime (§5). */
export function formatImportReport(r: ImportReport): string {
  const linhas = [
    `${r.providerId.toUpperCase()} ${r.editionId}`,
    "",
    `documentos descobertos: ${r.documentsDiscovered}`,
    `documentos baixados:    ${r.documentsFetched}`,
    "",
    `objetivas esperadas:    ${r.objectiveExpected}`,
    `objetivas extraídas:    ${r.objectiveParsed}`,
    "",
    `gabaritos esperados:    ${r.answerKeysExpected}`,
    `gabaritos casados:      ${r.answerKeysMatched}`,
    "",
    `anuladas:   ${r.annulled.length ? r.annulled.join(", ") : "nenhuma"}`,
    `sem par:    ${r.unmatched.length ? r.unmatched.join(", ") : "nenhuma"}`,
    `duplicadas: ${r.duplicates.length ? r.duplicates.join(", ") : "nenhuma"}`,
    "",
    "matérias:",
    ...Object.entries(r.subjects).map(([s, n]) => `  ${s}: ${n}`),
    "",
    `validação: ${r.validation.toUpperCase()}`,
  ];
  if (r.issues.length) {
    linhas.push("", "problemas:");
    for (const i of r.issues) {
      linhas.push(`  ${i.fatal ? "[FATAL]" : "[aviso]"} ${i.code}: ${i.message}`);
    }
  }
  return linhas.join("\n");
}

/* ------------------------------------------------------------------ *
 * Importador
 * ------------------------------------------------------------------ */

/** O que uma importação produz antes de virar catálogo. */
export interface RawImportedExam {
  providerId: string;
  sourceId: string;
  editionId: string;
  year: number;
  phase: string;
  importerVersion: string;
  fingerprints: DocumentFingerprint[];
  /** Números extraídos, gabarito e anuladas — a matéria-prima do validador. */
  parsedNumbers: number[];
  answerKey: Record<number, string>;
  annulled: number[];
  subjects: Record<string, number>;
  statementMode: StatementMode;
  extractionMethod: ExtractionMethod;
  rightsStatus: RightsStatus;
}

/**
 * Uma edição pronta para o catálogo.
 *
 * Só existe depois de passar pelo validador: não há caminho que crie isto a
 * partir de dados não julgados.
 */
export interface NormalizedExamEdition {
  providerId: string;
  editionId: string;
  year: number;
  phase: string;
  questionCount: number;
  subjects: Record<string, number>;
  validation: ValidationLevel;
  sourceId: string;
  importerVersion: string;
  fingerprints: DocumentFingerprint[];
  report: ImportReport;
}

/**
 * Promove uma importação bruta a edição normalizada.
 *
 * Devolve `null` quando o validador reprova — é assim que a plataforma
 * "falha fechado": não existe atalho que ignore o relatório.
 */
export function acceptEdition(
  bruto: RawImportedExam,
  relatorio: ImportReport,
  /** Nível concedido por conferência humana, quando houve (§40). */
  nivelConferido?: Exclude<ValidationLevel, "blocked">,
): NormalizedExamEdition | null {
  if (isBlocked(relatorio.validation)) return null;

  // Conferência humana pode elevar, nunca rebaixar em silêncio. E não pode
  // apagar um aviso: gabarito preliminar continua sendo preliminar mesmo
  // depois de alguém olhar.
  const preliminar = relatorio.issues.some((i) => i.code === "preliminary-key-only");
  const nivel: ValidationLevel = preliminar
    ? "provisional"
    : (nivelConferido ?? relatorio.validation);

  return {
    providerId: bruto.providerId,
    editionId: bruto.editionId,
    year: bruto.year,
    phase: bruto.phase,
    questionCount: relatorio.objectiveParsed,
    subjects: bruto.subjects,
    validation: nivel,
    sourceId: bruto.sourceId,
    importerVersion: bruto.importerVersion,
    fingerprints: bruto.fingerprints,
    report: { ...relatorio, validation: nivel },
  };
}
