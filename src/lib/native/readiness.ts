import type { Question } from "../domain/types";

export interface NativeCoverageIdentity {
  providerId: string;
  year: number;
  editionId?: string;
}

export interface NativeQuestionCoverage {
  total: number;
  ready: number;
  missing: number[];
  complete: boolean;
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * "Nativa" é uma propriedade da experiência, não da origem do dado:
 * o aluno precisa conseguir ler a questão inteira dentro do Studium.
 *
 * - Providers com texto estruturado (ex.: ENEM) passam pelo conteúdo semântico.
 * - NativePack passa pelos assets visuais assinados.
 * - `statementAvailable=false` nunca é executável, mesmo que exista PDF oficial.
 */
export function isQuestionNativeRenderable(question: Question): boolean {
  if (question.statementAvailable === false) return false;

  const hasVisual =
    (question.files ?? []).some(hasText) ||
    (question.alternatives ?? []).some((alternative) => hasText(alternative.file));
  const hasSemantic =
    hasText(question.context) ||
    hasText(question.alternativesIntroduction) ||
    (question.alternatives ?? []).some((alternative) => hasText(alternative.text));

  return hasVisual || hasSemantic;
}

export function nativeQuestionCoverage(questions: Question[]): NativeQuestionCoverage {
  const missing = questions
    .filter((question) => !isQuestionNativeRenderable(question))
    .map((question) => question.number ?? question.index);

  return {
    total: questions.length,
    ready: questions.length - missing.length,
    missing,
    complete: questions.length > 0 && missing.length === 0,
  };
}

export class NativeContentUnavailableError extends Error {
  readonly identity: NativeCoverageIdentity;
  readonly coverage: NativeQuestionCoverage;

  constructor(identity: NativeCoverageIdentity, coverage: NativeQuestionCoverage) {
    const edition = identity.editionId ? `/${identity.editionId}` : "";
    const sample = coverage.missing.slice(0, 8).join(", ");
    const suffix = coverage.missing.length > 8 ? ", …" : "";
    super(
      `${identity.providerId} ${identity.year}${edition} ainda não está 100% nativa: ` +
        `${coverage.ready}/${coverage.total} questões renderizáveis` +
        (sample ? ` (faltando Q${sample}${suffix})` : ""),
    );
    this.name = "NativeContentUnavailableError";
    this.identity = identity;
    this.coverage = coverage;
  }
}

export function assertNativeQuestionCoverage(
  questions: Question[],
  identity: NativeCoverageIdentity,
): void {
  const coverage = nativeQuestionCoverage(questions);
  if (!coverage.complete) {
    throw new NativeContentUnavailableError(identity, coverage);
  }
}
