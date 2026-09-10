import { pct } from "@/lib/format";
import { classifyContent, discipline, questionKey } from "@/lib/domain/classify";
import { AREA_LABELS } from "@/lib/domain/constants";
import { officialRowsOf, weakestContents } from "@/lib/domain/stats";
import { resolveProviderId, sameProvider } from "@/lib/providers/registry";
import type { DB, Difficulty, Question, ResultRow } from "@/lib/domain/types";
import type { AIQuestionContext, AIStudentSnapshot } from "./types";

function accuracy(correct: number, total: number): number | null {
  return total ? pct(correct, total) : null;
}

function personalDifficultyForRows(
  rows: ResultRow[],
  key: string,
  topic: string,
): Difficulty {
  const sameQuestion = rows.filter((row) => row.key === key);
  if (sameQuestion.length) {
    const rate = accuracy(
      sameQuestion.filter((row) => row.isCorrect).length,
      sameQuestion.length,
    ) ?? 0;
    const avgTime =
      sameQuestion.reduce((sum, row) => sum + Math.max(0, row.timeSec || 0), 0) /
      sameQuestion.length;
    if (rate >= 80 && avgTime < 150) return "facil";
    if (rate < 50 || avgTime > 240) return "dificil";
    return "media";
  }

  const topicRows = rows.filter(
    (row) => row.content === topic || row.tags?.includes(topic),
  );
  if (topicRows.length >= 5) {
    const rate = accuracy(
      topicRows.filter((row) => row.isCorrect).length,
      topicRows.length,
    ) ?? 0;
    if (rate >= 82) return "facil";
    if (rate < 55) return "dificil";
  }
  return "media";
}

function institutionFor(question: Question, providerId: string): string {
  const explicit = question.official?.official
    ? question.official.institution.trim()
    : "";
  if (explicit) return explicit;
  return providerId === "enem" ? "ENEM" : providerId;
}

export function buildStudentSnapshot(
  db: DB,
  question: Question,
  selectedAnswer?: string | null,
  attemptProviderId?: string | null,
): { question: AIQuestionContext; student: AIStudentSnapshot } {
  const providerId = resolveProviderId(question.providerId ?? attemptProviderId);
  const topic = classifyContent(question);
  const subjectId = discipline(question);
  const subject = AREA_LABELS[subjectId] || subjectId;
  const rows = officialRowsOf(db, providerId).filter((row) => row.correct);
  const recent = rows.slice(-50);
  const topicRows = rows.filter(
    (row) => row.content === topic || row.tags?.includes(topic),
  );
  const subjectRows = rows.filter((row) => row.area === subjectId);
  const key = questionKey(question);

  const questionContext: AIQuestionContext = {
    key,
    origin: {
      kind: "official",
      providerId,
      institution: institutionFor(question, providerId),
      year: question.year,
      questionNumber: question.number ?? question.index,
      sourceUrl: question.official?.official ? question.official.documentUrl : undefined,
    },
    statement: question.context || "",
    alternativesIntroduction: question.alternativesIntroduction || undefined,
    alternatives: (question.alternatives || []).map((alternative) => ({
      letter: alternative.letter,
      text: alternative.text || "",
      file: alternative.file || null,
    })),
    images: (question.files || []).map(String),
    correctAnswer:
      question.correctAlternative ||
      question.alternatives?.find((alternative) => alternative.isCorrect)?.letter ||
      null,
    selectedAnswer: selectedAnswer || null,
    subject,
    topic,
    difficulty: personalDifficultyForRows(rows, key, topic),
    language: question.language || null,
  };

  const student: AIStudentSnapshot = {
    completedAttempts: db.attempts.filter(
      (attempt) => !!attempt.result && sameProvider(attempt.providerId, providerId),
    ).length,
    recentQuestions: recent.length,
    recentAccuracy: accuracy(recent.filter((row) => row.isCorrect).length, recent.length),
    topicQuestions: topicRows.length,
    topicAccuracy: accuracy(topicRows.filter((row) => row.isCorrect).length, topicRows.length),
    subjectQuestions: subjectRows.length,
    subjectAccuracy: accuracy(
      subjectRows.filter((row) => row.isCorrect).length,
      subjectRows.length,
    ),
    highConfidenceErrors: recent.filter(
      (row) => row.isCorrect === false && row.confidence === "certeza",
    ).length,
    weakTopics: weakestContents(db, 3, providerId).map((item) => ({
      topic: item.name,
      accuracy: item.p,
      questions: item.t,
    })),
  };

  return { question: questionContext, student };
}
