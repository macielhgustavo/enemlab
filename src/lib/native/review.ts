import {
  nativePublicationGate,
  type NativeDocumentRecord,
  type NativePack,
  type NativeQuestionContentRecord,
  type NativeRect,
} from "./contracts";

function clonePack(pack: NativePack): NativePack {
  return JSON.parse(JSON.stringify(pack)) as NativePack;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseNativePackJson(json: string): NativePack {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("NativePack inválido: JSON malformado.");
  }
  if (!isRecord(raw) || raw.version !== 1) {
    throw new Error("NativePack inválido: versão não suportada.");
  }
  if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) {
    throw new Error("NativePack inválido: createdAt ausente ou inválido.");
  }
  if (!Array.isArray(raw.documents) || !raw.documents.length) {
    throw new Error("NativePack inválido: nenhum documento.");
  }
  if (!Array.isArray(raw.questions) || !raw.questions.length) {
    throw new Error("NativePack inválido: nenhuma questão.");
  }

  const pack = raw as unknown as NativePack;
  const documentIds = new Set<string>();
  for (const document of pack.documents) {
    if (!document.documentId?.trim()) throw new Error("NativePack inválido: documentId ausente.");
    if (documentIds.has(document.documentId)) {
      throw new Error(`NativePack inválido: documentId duplicado (${document.documentId}).`);
    }
    documentIds.add(document.documentId);
  }

  const keys = new Set<string>();
  for (const question of pack.questions) {
    if (!question.questionKey?.trim()) throw new Error("NativePack inválido: questionKey ausente.");
    if (keys.has(question.questionKey)) {
      throw new Error(`NativePack inválido: questionKey duplicada (${question.questionKey}).`);
    }
    keys.add(question.questionKey);
  }
  return pack;
}

export function documentForQuestion(
  pack: NativePack,
  question: NativeQuestionContentRecord,
): NativeDocumentRecord | undefined {
  return pack.documents.find((document) => document.documentId === question.documentId);
}

export function nativePageFilename(pattern: string, page: number): string {
  const padded = String(page).padStart(3, "0");
  const rendered = pattern
    .replace("{page:03d}", padded)
    .replace("{page}", String(page));
  return rendered.split("/").at(-1) || `page-${padded}.webp`;
}

export function updateNativeQuestionRect(
  pack: NativePack,
  questionKey: string,
  regionIndex: number,
  rect: NativeRect,
): NativePack {
  const next = clonePack(pack);
  const question = next.questions.find((candidate) => candidate.questionKey === questionKey);
  if (!question) throw new Error(`Questão nativa não encontrada: ${questionKey}`);
  const region = question.visualRegions[regionIndex];
  if (!region) throw new Error(`Região visual não encontrada: ${questionKey}#${regionIndex}`);
  region.rect = rect;
  question.status = "review";
  return next;
}

export function approveNativeQuestion(pack: NativePack, questionKey: string): NativePack {
  const next = clonePack(pack);
  const question = next.questions.find((candidate) => candidate.questionKey === questionKey);
  if (!question) throw new Error(`Questão nativa não encontrada: ${questionKey}`);
  const gate = nativePublicationGate(question, documentForQuestion(next, question));
  if (!gate.publishable) {
    throw new Error(`Questão não pode ser aprovada: ${gate.issues.join("; ")}`);
  }
  question.status = "published";
  return next;
}

export interface NativePackGateResult {
  publishable: boolean;
  published: number;
  total: number;
  issues: Array<{ questionKey: string; issues: string[] }>;
}

export function nativePackGate(pack: NativePack): NativePackGateResult {
  const issues: Array<{ questionKey: string; issues: string[] }> = [];
  let published = 0;
  for (const question of pack.questions) {
    const gate = nativePublicationGate(question, documentForQuestion(pack, question));
    const rowIssues = [...gate.issues];
    if (question.status !== "published") rowIssues.push("revisão humana ainda não aprovada");
    if (rowIssues.length) issues.push({ questionKey: question.questionKey, issues: rowIssues });
    else published += 1;
  }
  return {
    publishable: issues.length === 0 && pack.questions.length > 0,
    published,
    total: pack.questions.length,
    issues,
  };
}

export function approveAllStructurallyValid(pack: NativePack): NativePack {
  const next = clonePack(pack);
  for (const question of next.questions) {
    const gate = nativePublicationGate(question, documentForQuestion(next, question));
    if (gate.publishable) question.status = "published";
  }
  return next;
}
