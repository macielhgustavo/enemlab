import type {
  ExtractedExamData,
  ExtractedQuestion,
  SelectiveFallbackRequest,
  SelectiveFallbackResult,
  SelectiveFallbackTarget,
  SemanticFidelityIssue,
} from "./types";

const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const REPLACEMENT_CHARACTER = /\uFFFD/u;
const PRIVATE_USE_CHARACTER = /\p{Co}/u;

function issueKey(issue: SemanticFidelityIssue): string {
  return [
    issue.code,
    issue.severity,
    issue.questionNumber ?? "*",
    issue.page ?? "*",
    issue.field ?? "*",
    issue.message,
  ].join("|");
}

function dedupeIssues(issues: readonly SemanticFidelityIssue[]): SemanticFidelityIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issueKey(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scanText(
  value: string | undefined,
  question: ExtractedQuestion,
  field: SemanticFidelityIssue["field"],
): SemanticFidelityIssue[] {
  if (!value) return [];

  const base = {
    severity: "error" as const,
    questionNumber: question.number,
    page: question.page,
    field,
  };
  const issues: SemanticFidelityIssue[] = [];

  if (DISALLOWED_CONTROL.test(value)) {
    issues.push({
      ...base,
      code: "control-character",
      message: "texto contém caractere de controle incompatível com conteúdo educacional confiável",
    });
  }
  if (REPLACEMENT_CHARACTER.test(value)) {
    issues.push({
      ...base,
      code: "replacement-character",
      message: "texto contém U+FFFD, indicando glifo perdido ou decodificação incompleta",
    });
  }
  if (PRIVATE_USE_CHARACTER.test(value)) {
    issues.push({
      ...base,
      code: "private-use-character",
      message: "texto contém glifo Unicode de uso privado sem semântica portável garantida",
    });
  }

  return issues;
}

/**
 * Conservative semantic-fidelity gate.
 *
 * This gate does not pretend to prove mathematical correctness. It detects
 * machine-verifiable corruption signals and merges explicit extractor findings.
 * Ambiguities that cannot be proven from text alone stay for human/OCR review.
 */
export function assessSemanticFidelity(data: ExtractedExamData): SemanticFidelityIssue[] {
  const issues = [...(data.semanticFidelityIssues ?? [])];
  const questionNumbers = new Set(data.questions.map((question) => question.number));

  for (const issue of data.semanticFidelityIssues ?? []) {
    if (issue.questionNumber !== undefined && !questionNumbers.has(issue.questionNumber)) {
      issues.push({
        code: "extractor-reported",
        severity: "error",
        message: `extrator reportou fidelidade para questão inexistente ${issue.questionNumber}`,
      });
    }
  }

  for (const number of data.questionsMissingMedia ?? []) {
    if (!questionNumbers.has(number)) {
      issues.push({
        code: "extractor-reported",
        severity: "error",
        message: `extrator reportou mídia faltante para questão inexistente ${number}`,
      });
    }
  }

  for (const question of data.questions) {
    issues.push(...scanText(question.statement, question, "statement"));
    issues.push(...scanText(question.context, question, "context"));
    for (const alternative of question.alternatives ?? []) {
      issues.push(...scanText(alternative.text, question, `alternative:${alternative.id}`));
    }
  }

  return dedupeIssues(issues);
}

export function issueBlocksQuestion(
  issue: SemanticFidelityIssue,
  question: ExtractedQuestion,
): boolean {
  // External payloads are untrusted at runtime. Only an explicit, valid
  // warning is non-blocking; unknown severities fail closed.
  if (issue.severity === "warning") return false;
  if (issue.questionNumber !== undefined) return issue.questionNumber === question.number;
  if (issue.page !== undefined) return issue.page === question.page;
  return true;
}

export function questionHasCompleteStructure(
  question: ExtractedQuestion,
  allowedLetters: readonly string[],
): boolean {
  if (!question.statement?.trim()) return false;
  const alternatives = question.alternatives ?? [];
  if (alternatives.length !== allowedLetters.length) return false;
  const ids = alternatives.map((alternative) => alternative.id.trim());
  if (!allowedLetters.every((letter, index) => ids[index] === letter)) return false;
  return alternatives.every(
    (alternative) => Boolean(alternative.text?.trim()) || Boolean(alternative.file?.trim()),
  );
}

function targetKey(target: SelectiveFallbackTarget): string {
  return [target.questionNumber ?? "*", target.page ?? "*", target.reason].join("|");
}

/** Build an exception-driven fallback request instead of reprocessing a full exam. */
export function buildSelectiveFallbackRequest(
  data: ExtractedExamData,
  allowedLetters: readonly string[],
): SelectiveFallbackRequest {
  const targets: SelectiveFallbackTarget[] = [];
  const semanticIssues = assessSemanticFidelity(data);
  const missingMedia = new Set(data.questionsMissingMedia ?? []);

  for (const question of data.questions) {
    if (!questionHasCompleteStructure(question, allowedLetters)) {
      targets.push({
        questionNumber: question.number,
        page: question.page,
        reason: "incomplete-structure",
        message: "enunciado/alternativas não foram recuperados com a estrutura objetiva esperada",
      });
    }
    if (missingMedia.has(question.number)) {
      targets.push({
        questionNumber: question.number,
        page: question.page,
        reason: "missing-media",
        message: "questão depende de mídia ainda não associada",
      });
    }
  }

  for (const issue of semanticIssues) {
    if (issue.severity === "warning") continue;
    // Global corruption/metadata failures have no safe selective locator. They
    // remain blocking, but must not be converted into an invalid OCR request.
    if (issue.questionNumber === undefined && issue.page === undefined) continue;
    targets.push({
      questionNumber: issue.questionNumber,
      page: issue.page,
      reason: "semantic-fidelity",
      message: issue.message,
    });
  }

  const seen = new Set<string>();
  return {
    targets: targets.filter((target) => {
      const key = targetKey(target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function targetMatchesQuestion(
  target: SelectiveFallbackTarget,
  question: ExtractedQuestion,
): boolean {
  if (target.questionNumber !== undefined && target.questionNumber === question.number) return true;
  return target.questionNumber === undefined && target.page !== undefined && target.page === question.page;
}

function hasRequestedMissingMediaResolution(
  request: SelectiveFallbackRequest,
  questionNumber: number,
): boolean {
  return request.targets.some(
    (target) => target.reason === "missing-media" && target.questionNumber === questionNumber,
  );
}

/**
 * Merge only the identities explicitly authorized by a selective fallback request.
 * A fallback cannot smuggle in or rewrite unrelated questions.
 */
export function mergeSelectiveFallback(
  primary: ExtractedExamData,
  fallback: SelectiveFallbackResult,
  request: SelectiveFallbackRequest,
): ExtractedExamData {
  const originalByNumber = new Map(primary.questions.map((question) => [question.number, question]));
  const replacements = new Map<number, ExtractedQuestion>();

  for (const question of fallback.questions) {
    const original = originalByNumber.get(question.number);
    if (!original) {
      throw new Error(`fallback returned unknown question ${question.number}`);
    }
    if (!request.targets.some((target) => targetMatchesQuestion(target, original))) {
      throw new Error(`fallback attempted to replace unrequested question ${question.number}`);
    }
    if (replacements.has(question.number)) {
      throw new Error(`fallback returned duplicate question ${question.number}`);
    }
    replacements.set(question.number, question);
  }

  const replacedNumbers = new Set(replacements.keys());
  const resolvedMissingMedia = new Set(fallback.resolvedMissingMedia ?? []);
  const fallbackMissingMedia = new Set(fallback.questionsMissingMedia ?? []);

  for (const number of resolvedMissingMedia) {
    if (!replacedNumbers.has(number)) {
      throw new Error(`fallback resolved media for unreplaced question ${number}`);
    }
    if (!hasRequestedMissingMediaResolution(request, number)) {
      throw new Error(`fallback resolved unrequested missing media for question ${number}`);
    }
  }
  for (const number of fallbackMissingMedia) {
    if (!replacedNumbers.has(number)) {
      throw new Error(`fallback reported missing media for unreplaced question ${number}`);
    }
  }

  // Missing-media state is preserved by default. Clearing it is an explicit
  // assertion made only for a requested/replaced question.
  const missingMedia = new Set(primary.questionsMissingMedia ?? []);
  for (const number of resolvedMissingMedia) missingMedia.delete(number);
  for (const number of fallbackMissingMedia) missingMedia.add(number);

  const retainedPrimaryIssues = (primary.semanticFidelityIssues ?? []).filter((issue) => {
    if (issue.questionNumber !== undefined) {
      return !replacedNumbers.has(issue.questionNumber);
    }
    if (issue.page !== undefined) {
      const questionsOnPage = primary.questions.filter((question) => question.page === issue.page);
      if (!questionsOnPage.length) return true;
      return !questionsOnPage.every((question) => replacedNumbers.has(question.number));
    }
    return true;
  });

  return {
    ...primary,
    questions: primary.questions.map((question) => replacements.get(question.number) ?? question),
    questionsMissingMedia: [...missingMedia].sort((a, b) => a - b),
    semanticFidelityIssues: [
      ...retainedPrimaryIssues,
      ...(fallback.semanticFidelityIssues ?? []),
    ],
    warnings: [...(primary.warnings ?? []), ...(fallback.warnings ?? [])],
  };
}
