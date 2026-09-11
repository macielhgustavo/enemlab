import { pct } from "../format";
import type { DB, ResultRow, StudentAIAssistanceTrace } from "../domain/types";
import { isHighAssistance } from "./assistance";

export interface AssistanceAwarePerformance {
  evaluatedQuestions: number;
  correct: number;
  rawAccuracy: number | null;
  independentQuestions: number;
  independentCorrect: number;
  independentAccuracy: number | null;
  highAssistanceQuestions: number;
  correctWithHighAssistance: number;
  correctWithHighAssistanceShare: number | null;
}

function traceForRow(
  db: DB,
  row: ResultRow,
): StudentAIAssistanceTrace | undefined {
  if (!row.attemptId) return undefined;
  const attempt = db.attempts.find((item) => item.id === row.attemptId);
  return attempt?.aiAssistance?.[row.key];
}

/**
 * Mede evidência de desempenho sem alterar o resultado oficial da tentativa.
 * Uma questão com assistência alta deixa de ser evidência "independente", mas
 * continua contando normalmente na nota bruta. A classificação é conservadora:
 * não afirma que a IA causou o acerto, apenas que houve ajuda alta na questão.
 */
export function assistanceAwarePerformance(
  db: DB,
  rows: ResultRow[],
): AssistanceAwarePerformance {
  const evaluated = rows.filter(
    (row) => !!row.correct && typeof row.isCorrect === "boolean",
  );

  let correct = 0;
  let independentQuestions = 0;
  let independentCorrect = 0;
  let highAssistanceQuestions = 0;
  let correctWithHighAssistance = 0;

  for (const row of evaluated) {
    const isCorrect = row.isCorrect === true;
    const highAssistance = isHighAssistance(traceForRow(db, row));

    if (isCorrect) correct++;

    if (highAssistance) {
      highAssistanceQuestions++;
      if (isCorrect) correctWithHighAssistance++;
      continue;
    }

    independentQuestions++;
    if (isCorrect) independentCorrect++;
  }

  return {
    evaluatedQuestions: evaluated.length,
    correct,
    rawAccuracy: evaluated.length ? pct(correct, evaluated.length) : null,
    independentQuestions,
    independentCorrect,
    independentAccuracy: independentQuestions
      ? pct(independentCorrect, independentQuestions)
      : null,
    highAssistanceQuestions,
    correctWithHighAssistance,
    correctWithHighAssistanceShare: correct
      ? pct(correctWithHighAssistance, correct)
      : null,
  };
}
