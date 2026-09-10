// Auditoria de qualidade das questões — v7.2.
// Detecta problemas estruturais e de apresentação sem alterar o conteúdo da prova.
import { repairQuestionText, safeUrl } from "../format";
import { classifyQuestion, isUnclassifiedContent } from "./classify";
import type { Question } from "./types";

export type QuestionQualitySeverity = "info" | "warning" | "error";
export type QuestionQualityStatus = "healthy" | "review" | "blocked";

export interface QuestionQualityIssue {
  code: string;
  severity: QuestionQualitySeverity;
  label: string;
  field?: string;
}

export interface QuestionQualityReport {
  score: number;
  status: QuestionQualityStatus;
  scoreable: boolean;
  issues: QuestionQualityIssue[];
  mediaCount: number;
  classificationConfidence: "alta" | "media" | "baixa";
  classificationPrimary: string;
}

export interface QuestionBankAudit {
  total: number;
  healthy: number;
  review: number;
  blocked: number;
  averageScore: number;
  scoreable: number;
  lowClassification: number;
  unclassified: number;
  issueCounts: { code: string; label: string; count: number; severity: QuestionQualitySeverity }[];
}

function issue(
  code: string,
  severity: QuestionQualitySeverity,
  label: string,
  field?: string,
): QuestionQualityIssue {
  return { code, severity, label, field };
}

function rawQuestionText(q: Question): string {
  return [
    q.context || "",
    q.alternativesIntroduction || "",
    ...(q.alternatives || []).map((a) => a.text || ""),
  ].join("\n");
}

function countUnsupportedHtml(raw: string): number {
  const allowed = new Set(["br", "sup", "sub", "strong", "b", "em", "i"]);
  const tags = raw.match(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi) || [];
  return tags.filter((tag) => {
    const name = tag.match(/<\/?([a-z][a-z0-9-]*)/i)?.[1]?.toLowerCase();
    return !!name && !allowed.has(name);
  }).length;
}

function hasUnbalancedMath(raw: string): boolean {
  const displayDollar = (raw.match(/\$\$/g) || []).length;
  const openParen = (raw.match(/\\\(/g) || []).length;
  const closeParen = (raw.match(/\\\)/g) || []).length;
  const openBracket = (raw.match(/\\\[/g) || []).length;
  const closeBracket = (raw.match(/\\\]/g) || []).length;
  return displayDollar % 2 !== 0 || openParen !== closeParen || openBracket !== closeBracket;
}

function allMedia(q: Question): string[] {
  return [
    ...(q.files || []).map(String),
    ...(q.alternatives || []).map((a) => String(a.file || "")).filter(Boolean),
  ];
}

/** Fecha o relatório a partir das ocorrências, com a mesma régua de severidade. */
function buildReport(q: Question, issues: QuestionQualityIssue[]): QuestionQualityReport {
  const errorCount = issues.filter((x) => x.severity === "error").length;
  const warningCount = issues.filter((x) => x.severity === "warning").length;
  const infoCount = issues.filter((x) => x.severity === "info").length;
  return {
    score: Math.max(0, 100 - errorCount * 35 - warningCount * 11 - infoCount * 2),
    status: errorCount ? "blocked" : warningCount ? "review" : "healthy",
    // Sem gabarito não há como pontuar — vale para qualquer modo.
    scoreable: !!q.correctAlternative,
    issues,
    mediaCount: 0,
    classificationConfidence: "alta",
    classificationPrimary: String(q.discipline || ""),
  };
}

/**
 * Questão de fonte apenas-referência (prova digitalizada): o enunciado vive no
 * documento oficial de propósito. Cobrar texto e alternativas dela marcaria
 * toda a prova como quebrada — o que se cobra é a procedência.
 */
function inspectReferenceQuestion(q: Question): QuestionQualityIssue[] {
  const issues: QuestionQualityIssue[] = [];
  const src = q.official;

  if (!src || !src.institution) {
    issues.push(issue("missing-source", "error", "Questão de referência sem fonte oficial", "context"));
  }
  if (!src?.documentUrl || !safeUrl(src.documentUrl)) {
    issues.push(issue("invalid-source-url", "error", "URL do documento oficial inválida", "context"));
  }
  if (!q.number || q.number < 1) {
    issues.push(issue("missing-number", "error", "Questão sem numeração oficial", "context"));
  }
  if (!String(q.discipline || "").trim()) {
    issues.push(issue("missing-subject", "error", "Questão sem matéria", "context"));
  }
  // Gabarito ausente só é problema se a questão não foi anulada — e anulada
  // chega aqui justamente sem gabarito, então isto é aviso, não erro.
  if (!q.correctAlternative) {
    issues.push(
      issue("missing-answer-key", "warning", "Sem gabarito (questão anulada?)", "alternatives"),
    );
  }
  return issues;
}

export function inspectQuestion(q: Question): QuestionQualityReport {
  const issues: QuestionQualityIssue[] = [];

  if (q.statementAvailable === false) {
    return buildReport(q, inspectReferenceQuestion(q));
  }
  const raw = rawQuestionText(q);
  const repaired = repairQuestionText(raw);
  const alternatives = q.alternatives || [];
  const letters = alternatives.map((a) => String(a.letter || "").trim().toUpperCase()).filter(Boolean);
  const media = allMedia(q);
  const validMedia = media.filter((url) => safeUrl(url));
  const stemText = repairQuestionText(`${q.context || ""} ${q.alternativesIntroduction || ""}`).trim();

  if (!stemText && validMedia.length === 0) {
    issues.push(issue("missing-stem", "error", "Enunciado ausente", "context"));
  } else if (stemText.length < 18 && validMedia.length === 0) {
    issues.push(issue("short-stem", "warning", "Enunciado muito curto", "context"));
  }

  if (alternatives.length < 2) {
    issues.push(issue("missing-alternatives", "error", "Alternativas insuficientes", "alternatives"));
  } else if (alternatives.length !== 5) {
    issues.push(
      issue(
        "unexpected-alternative-count",
        "warning",
        `Quantidade incomum de alternativas (${alternatives.length})`,
        "alternatives",
      ),
    );
  }

  if (new Set(letters).size !== letters.length) {
    issues.push(issue("duplicate-alternative-letter", "error", "Letras de alternativas duplicadas", "alternatives"));
  }

  alternatives.forEach((alt, index) => {
    const text = repairQuestionText(alt.text || "").trim();
    const file = safeUrl(alt.file || "");
    if (!String(alt.letter || "").trim()) {
      issues.push(issue("missing-alternative-letter", "error", `Alternativa ${index + 1} sem letra`, "alternatives"));
    }
    if (!text && !file) {
      issues.push(issue("empty-alternative", "error", `Alternativa ${alt.letter || index + 1} vazia`, "alternatives"));
    }
  });

  const markedCorrect = alternatives.filter((a) => a.isCorrect).map((a) => a.letter);
  const correct = String(q.correctAlternative || "").trim().toUpperCase();
  if (!correct && markedCorrect.length === 0) {
    issues.push(issue("missing-answer-key", "error", "Gabarito ausente", "correctAlternative"));
  }
  if (correct && !letters.includes(correct)) {
    issues.push(issue("answer-not-in-alternatives", "error", "Gabarito não existe entre as alternativas", "correctAlternative"));
  }
  if (markedCorrect.length > 1) {
    issues.push(issue("multiple-correct-alternatives", "error", "Mais de uma alternativa marcada como correta", "alternatives"));
  }
  if (correct && markedCorrect.length === 1 && markedCorrect[0] !== correct) {
    issues.push(issue("conflicting-answer-key", "error", "Gabaritos conflitantes na fonte", "correctAlternative"));
  }

  for (const url of media) {
    if (url && !safeUrl(url)) {
      issues.push(issue("invalid-media-url", "warning", "URL de mídia inválida", "files"));
      break;
    }
  }

  if (/Ã|Â|â€|â€™|â€œ|â€|â€“|â€”|ï»¿/.test(raw)) {
    issues.push(issue("mojibake", "warning", "Texto chegou com codificação corrompida", "text"));
  }
  if (/�/.test(raw)) {
    issues.push(issue("replacement-character", "error", "Texto contém caractere de substituição (�)", "text"));
  }
  if (raw !== repaired && !issues.some((x) => x.code === "mojibake")) {
    issues.push(issue("text-normalized", "info", "Texto exigiu normalização de apresentação", "text"));
  }
  if (hasUnbalancedMath(raw)) {
    issues.push(issue("unbalanced-math", "warning", "Delimitadores matemáticos parecem incompletos", "text"));
  }
  if (countUnsupportedHtml(raw) > 0) {
    issues.push(issue("unsupported-html", "warning", "HTML não suportado pode aparecer como texto", "text"));
  }

  const classification = classifyQuestion(q);
  if (classification.confidence === "baixa") {
    issues.push(issue("low-classification-confidence", "warning", "Classificação de conteúdo com baixa confiança", "classification"));
  }
  if (isUnclassifiedContent(classification.primary)) {
    issues.push(issue("unclassified-content", "warning", "Conteúdo ainda não classificado", "classification"));
  }

  const errorCount = issues.filter((x) => x.severity === "error").length;
  const warningCount = issues.filter((x) => x.severity === "warning").length;
  const infoCount = issues.filter((x) => x.severity === "info").length;
  const score = Math.max(0, 100 - errorCount * 35 - warningCount * 11 - infoCount * 2);
  const status: QuestionQualityStatus = errorCount ? "blocked" : warningCount ? "review" : "healthy";
  const scoreable = !issues.some((x) =>
    [
      "missing-answer-key",
      "answer-not-in-alternatives",
      "multiple-correct-alternatives",
      "conflicting-answer-key",
      "missing-alternatives",
      "empty-alternative",
    ].includes(x.code),
  );

  return {
    score,
    status,
    scoreable,
    issues,
    mediaCount: validMedia.length,
    classificationConfidence: classification.confidence,
    classificationPrimary: classification.primary,
  };
}

export function isQuestionUsableForPractice(q: Question): boolean {
  const report = inspectQuestion(q);
  return report.status !== "blocked" && report.scoreable;
}

export function auditQuestionSet(questions: Question[]): QuestionBankAudit {
  const reports = questions.map(inspectQuestion);
  const issueMap = new Map<string, { label: string; count: number; severity: QuestionQualitySeverity }>();
  for (const report of reports) {
    for (const item of report.issues) {
      const current = issueMap.get(item.code);
      if (current) current.count += 1;
      else issueMap.set(item.code, { label: item.label, count: 1, severity: item.severity });
    }
  }

  return {
    total: reports.length,
    healthy: reports.filter((x) => x.status === "healthy").length,
    review: reports.filter((x) => x.status === "review").length,
    blocked: reports.filter((x) => x.status === "blocked").length,
    averageScore: reports.length
      ? Math.round(reports.reduce((sum, x) => sum + x.score, 0) / reports.length)
      : 0,
    scoreable: reports.filter((x) => x.scoreable).length,
    lowClassification: reports.filter((x) => x.classificationConfidence === "baixa").length,
    unclassified: reports.filter((x) => isUnclassifiedContent(x.classificationPrimary)).length,
    issueCounts: [...issueMap.entries()]
      .map(([code, value]) => ({ code, ...value }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  };
}
