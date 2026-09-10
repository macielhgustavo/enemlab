import type {
  DB,
  StudentAIAssistanceEvent,
  StudentAIAssistanceLevel,
  StudentAIAssistanceTrace,
} from "../domain/types";
import { isHighStudentAIAssistance } from "../domain/ai-assistance";
import type { AIResponse } from "./types";

const MAX_RECENT_EVENTS = 12;

function maxLevel(
  current: StudentAIAssistanceLevel,
  next: StudentAIAssistanceLevel,
): StudentAIAssistanceLevel {
  return Math.max(current, next) as StudentAIAssistanceLevel;
}

export function assistanceEventFromResponse(
  response: AIResponse,
  at = new Date().toISOString(),
): StudentAIAssistanceEvent {
  return {
    at,
    mode: response.mode,
    level: response.level,
    answerRevealed: response.revealAnswer,
    provider: response.provider,
    fallbackFrom: response.fallbackFrom,
  };
}

/**
 * Persiste somente metadados pedagógicos da interação. O texto digitado pelo
 * aluno e a resposta do modelo não entram no histórico, reduzindo exposição
 * de conteúdo pessoal e evitando crescimento ilimitado do localStorage.
 */
export function recordStudentAIAssistance(
  db: DB,
  attemptId: string,
  questionKey: string,
  response: AIResponse,
  at = new Date().toISOString(),
): boolean {
  const attempt = db.attempts.find((item) => item.id === attemptId);
  if (!attempt || !questionKey) return false;

  const event = assistanceEventFromResponse(response, at);
  attempt.aiAssistance ??= {};
  const current = attempt.aiAssistance[questionKey];

  if (!current) {
    attempt.aiAssistance[questionKey] = {
      requests: 1,
      maxLevel: event.level,
      answerRevealed: event.answerRevealed,
      modes: [event.mode],
      firstAt: event.at,
      lastAt: event.at,
      lastProvider: event.provider,
      fallbackUsed: !!event.fallbackFrom,
      recent: [event],
    };
    return true;
  }

  attempt.aiAssistance[questionKey] = {
    requests: current.requests + 1,
    maxLevel: maxLevel(current.maxLevel, event.level),
    answerRevealed: current.answerRevealed || event.answerRevealed,
    modes: current.modes.includes(event.mode)
      ? current.modes
      : [...current.modes, event.mode],
    firstAt: current.firstAt,
    lastAt: event.at,
    lastProvider: event.provider,
    fallbackUsed: current.fallbackUsed || !!event.fallbackFrom,
    recent: [...current.recent, event].slice(-MAX_RECENT_EVENTS),
  };
  return true;
}

export function assistanceForQuestion(
  db: DB,
  attemptId: string,
  questionKey: string,
): StudentAIAssistanceTrace | undefined {
  return db.attempts.find((item) => item.id === attemptId)?.aiAssistance?.[questionKey];
}

/** Compatibilidade para consumidores já existentes do módulo de IA. */
export const isHighAssistance = isHighStudentAIAssistance;
