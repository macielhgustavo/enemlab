import type { Question } from "../domain/types";

export const LOCAL_NATIVE_STORAGE_KEY = "studium-labs-native-local-v1";

export interface LocalNativeAlternative {
  letter: string;
  text: string;
}

export interface LocalNativeQuestionDraft {
  providerId: string;
  year: number;
  editionId?: string;
  phase: string;
  number: number;
  context: string;
  alternativesIntroduction?: string;
  alternatives: LocalNativeAlternative[];
  sourceDocumentSha256: string;
}

export interface LocalNativeBundle {
  version: 1;
  distribution: "local-only";
  createdAt: string;
  questions: LocalNativeQuestionDraft[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function questionIdentity(question: {
  providerId?: string;
  year: number;
  editionId?: string;
  phase?: string;
  number?: number;
  index: number;
}): string {
  return [
    question.providerId ?? "enem",
    question.editionId ?? String(question.year),
    question.phase ?? "single",
    String(question.number ?? question.index),
  ].join("|");
}

function draftIdentity(draft: LocalNativeQuestionDraft): string {
  return [
    draft.providerId,
    draft.editionId ?? String(draft.year),
    draft.phase,
    String(draft.number),
  ].join("|");
}

export function validateLocalNativeBundle(input: unknown): LocalNativeBundle {
  if (!isRecord(input)) throw new Error("Bundle local inválido.");
  if (input.version !== 1) throw new Error("Versão de bundle local não suportada.");
  if (input.distribution !== "local-only") {
    throw new Error("Conteúdo nativo importado deve permanecer local-only.");
  }
  if (typeof input.createdAt !== "string" || Number.isNaN(Date.parse(input.createdAt))) {
    throw new Error("createdAt inválido no bundle local.");
  }
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error("Bundle local sem questões.");
  }

  const identities = new Set<string>();
  const questions = input.questions.map((raw, index): LocalNativeQuestionDraft => {
    if (!isRecord(raw)) throw new Error(`Questão local ${index + 1} inválida.`);
    const providerId = raw.providerId;
    const year = raw.year;
    const editionId = raw.editionId;
    const phase = raw.phase;
    const number = raw.number;
    const context = raw.context;
    const alternativesIntroduction = raw.alternativesIntroduction;
    const alternatives = raw.alternatives;
    const sourceDocumentSha256 = raw.sourceDocumentSha256;

    if (typeof providerId !== "string" || !providerId.trim()) {
      throw new Error(`Questão local ${index + 1}: providerId ausente.`);
    }
    if (!Number.isInteger(year) || Number(year) < 1900 || Number(year) > 2100) {
      throw new Error(`Questão local ${index + 1}: ano inválido.`);
    }
    if (editionId !== undefined && (typeof editionId !== "string" || !editionId.trim())) {
      throw new Error(`Questão local ${index + 1}: editionId inválido.`);
    }
    if (typeof phase !== "string" || !phase.trim()) {
      throw new Error(`Questão local ${index + 1}: fase ausente.`);
    }
    if (!Number.isInteger(number) || Number(number) < 1) {
      throw new Error(`Questão local ${index + 1}: número inválido.`);
    }
    if (typeof context !== "string" || !context.trim()) {
      throw new Error(`Questão local ${index + 1}: enunciado vazio.`);
    }
    if (
      alternativesIntroduction !== undefined &&
      typeof alternativesIntroduction !== "string"
    ) {
      throw new Error(`Questão local ${index + 1}: introdução das alternativas inválida.`);
    }
    if (!isSha256(sourceDocumentSha256)) {
      throw new Error(`Questão local ${index + 1}: SHA-256 da fonte inválido.`);
    }
    if (!Array.isArray(alternatives) || alternatives.length < 2) {
      throw new Error(`Questão local ${index + 1}: alternativas insuficientes.`);
    }

    const letters = new Set<string>();
    const normalizedAlternatives = alternatives.map((alternative, alternativeIndex) => {
      if (!isRecord(alternative)) {
        throw new Error(`Questão local ${index + 1}: alternativa ${alternativeIndex + 1} inválida.`);
      }
      const letter = alternative.letter;
      const text = alternative.text;
      if (typeof letter !== "string" || !/^[A-E]$/.test(letter)) {
        throw new Error(`Questão local ${index + 1}: letra de alternativa inválida.`);
      }
      if (letters.has(letter)) {
        throw new Error(`Questão local ${index + 1}: alternativa ${letter} duplicada.`);
      }
      if (typeof text !== "string" || !text.trim()) {
        throw new Error(`Questão local ${index + 1}: alternativa ${letter} vazia.`);
      }
      letters.add(letter);
      return { letter, text };
    });

    const draft: LocalNativeQuestionDraft = {
      providerId,
      year: Number(year),
      editionId: editionId as string | undefined,
      phase,
      number: Number(number),
      context,
      alternativesIntroduction: alternativesIntroduction as string | undefined,
      alternatives: normalizedAlternatives,
      sourceDocumentSha256,
    };
    const identity = draftIdentity(draft);
    if (identities.has(identity)) throw new Error(`Questão local duplicada: ${identity}.`);
    identities.add(identity);
    return draft;
  });

  return {
    version: 1,
    distribution: "local-only",
    createdAt: input.createdAt,
    questions,
  };
}

export function parseLocalNativeBundle(json: string): LocalNativeBundle {
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    throw new Error("JSON do bundle local inválido.");
  }
  return validateLocalNativeBundle(input);
}

export function saveLocalNativeBundle(bundle: LocalNativeBundle): number {
  const validated = validateLocalNativeBundle(bundle);
  if (typeof window === "undefined") {
    throw new Error("Bundle local só pode ser salvo no navegador.");
  }
  window.localStorage.setItem(LOCAL_NATIVE_STORAGE_KEY, JSON.stringify(validated));
  return validated.questions.length;
}

export function importLocalNativeBundle(json: string): number {
  return saveLocalNativeBundle(parseLocalNativeBundle(json));
}

export function clearLocalNativeBundle(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(LOCAL_NATIVE_STORAGE_KEY);
}

export function loadLocalNativeBundle(): LocalNativeBundle | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LOCAL_NATIVE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return parseLocalNativeBundle(raw);
  } catch {
    return null;
  }
}

export function applyLocalNativeDraft(
  question: Question,
  draft: LocalNativeQuestionDraft,
): Question {
  if (questionIdentity(question) !== draftIdentity(draft)) return question;
  const baseLetters = (question.alternatives ?? []).map((alternative) => alternative.letter);
  const draftLetters = draft.alternatives.map((alternative) => alternative.letter);
  if (
    baseLetters.length !== draftLetters.length ||
    baseLetters.some((letter, index) => letter !== draftLetters[index])
  ) {
    // Fail closed: texto local nunca pode mudar a estrutura da resposta.
    return question;
  }

  const textByLetter = new Map(
    draft.alternatives.map((alternative) => [alternative.letter, alternative.text]),
  );
  return {
    ...question,
    context: draft.context,
    alternativesIntroduction: draft.alternativesIntroduction,
    alternatives: (question.alternatives ?? []).map((alternative) => ({
      ...alternative,
      text: textByLetter.get(alternative.letter) ?? alternative.text,
    })),
    statementAvailable: true,
  };
}

/**
 * Aplica conteúdo que o próprio usuário importou no navegador. O bundle vive
 * fora do DB principal, portanto não entra em backup/cloud sync do Studium.
 */
export function applyLocalNativeDrafts(questions: Question[]): Question[] {
  const bundle = loadLocalNativeBundle();
  if (!bundle) return questions;
  const drafts = new Map(bundle.questions.map((draft) => [draftIdentity(draft), draft]));
  return questions.map((question) => {
    const draft = drafts.get(questionIdentity(question));
    return draft ? applyLocalNativeDraft(question, draft) : question;
  });
}
