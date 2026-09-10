import { pct } from "@/lib/format";
import { classifyContent, discipline, questionKey } from "@/lib/domain/classify";
import { AREA_LABELS } from "@/lib/domain/constants";
import { officialRows, personalDifficulty, weakestContents } from "@/lib/domain/stats";
import type { DB, Question } from "@/lib/domain/types";
import type { AIQuestionContext, AIStudentSnapshot } from "./types";

function accuracy(correct: number, total: number): number | null {
  return total ? pct(correct, total) : null;
}

export function buildStudentSnapshot(
  db: DB,
  question: Question,
  selectedAnswer?: string | null,
): { question: AIQuestionContext; student: AIStudentSnapshot } {
  const topic = classifyContent(question);
  const subjectId = discipline(question);
  const subject = AREA_LABELS[subjectId] || subjectId;
  const rows = officialRows(db).filter((row) => row.correct);
  const recent = rows.slice(-50);
  const topicRows = rows.filter((row) => row.content === topic || row.tags?.includes(topic));
  const subjectRows = rows.filter((row) => row.area === subjectId);

  const questionContext: AIQuestionContext = {
    key: questionKey(question),
    origin: {
      kind: "official",
      institution: "ENEM",
      year: question.year,
      questionNumber: question.index,
    },
    statement: question.context || "",
    alternativesIntroduction: question.alternativesIntroduction || undefined,
    alternatives: (question.alternatives || []).map((alternative) => ({
      letter: alternative.letter,
      text: alternative.text || "",
    })),
    correctAnswer:
      question.correctAlternative ||
      question.alternatives?.find((alternative) => alternative.isCorrect)?.letter ||
      null,
    selectedAnswer: selectedAnswer || null,
    subject,
    topic,
    difficulty: personalDifficulty(db, question),
    language: question.language || null,
  };

  const student: AIStudentSnapshot = {
    completedAttempts: db.attempts.filter((attempt) => !!attempt.result).length,
    recentQuestions: recent.length,
    recentAccuracy: accuracy(recent.filter((row) => row.isCorrect).length, recent.length),
    topicQuestions: topicRows.length,
    topicAccuracy: accuracy(topicRows.filter((row) => row.isCorrect).length, topicRows.length),
    subjectQuestions: subjectRows.length,
    subjectAccuracy: accuracy(subjectRows.filter((row) => row.isCorrect).length, subjectRows.length),
    highConfidenceErrors: recent.filter(
      (row) => row.isCorrect === false && row.confidence === "certeza",
    ).length,
    weakTopics: weakestContents(db, 3).map((item) => ({
      topic: item.name,
      accuracy: item.p,
      questions: item.t,
    })),
  };

  return { question: questionContext, student };
}
