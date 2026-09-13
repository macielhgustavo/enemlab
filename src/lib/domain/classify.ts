import { academicMetadataForQuestion } from "../academic";
import type { Question } from "./types";
import * as base from "./classify-base";

export type {
  ClassificationConfidence,
  QuestionClassification,
} from "./classify-base";
export {
  discipline,
  questionKey,
  isUnclassifiedContent,
  contentAllLabels,
} from "./classify-base";

function uniquePath(parts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || out[out.length - 1] === part) continue;
    out.push(part);
  }
  return out;
}

/**
 * Classificação pública do Studium.
 *
 * Metadado acadêmico revisado tem precedência porque continua disponível em
 * questões reference-only, onde o texto não pode ser redistribuído. Quando
 * não existe mapa explícito, delegamos integralmente ao classificador v7.2.
 */
export function classifyQuestion(q: Question): base.QuestionClassification {
  const reviewed = academicMetadataForQuestion(q);
  if (!reviewed) return base.classifyQuestion(q);

  const tags = [reviewed.topic, reviewed.discipline, reviewed.subtopic]
    .filter((value): value is string => Boolean(value));

  return {
    primary: reviewed.topic,
    tags: [...new Set(tags)].slice(0, 3),
    path: uniquePath([
      reviewed.area,
      reviewed.discipline,
      reviewed.topic,
      reviewed.subtopic,
    ]),
    subtopic: reviewed.subtopic,
    confidence: reviewed.confidence,
    score: 100,
    margin: 100,
    evidence: [reviewed.evidence],
  };
}

export function classifyContent(q: Question): string {
  return classifyQuestion(q).primary;
}

export function finalTagRules(q: Question): string[] {
  return classifyQuestion(q).tags;
}
