"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { buildStudentSnapshot } from "@/lib/ai/context";
import { recordStudentAIAssistance } from "@/lib/ai/assistance";
import type { AIResponse } from "@/lib/ai/types";
import { questionKey } from "@/lib/domain/classify";
import { questionsForAttempt } from "@/lib/services/attempts";
import StudentAITutor from "@/components/StudentAITutor";

function hasUsableText(question: {
  statementAvailable?: boolean;
  context?: string;
  alternativesIntroduction?: string;
  alternatives?: Array<{ text?: string }>;
}): boolean {
  if (question.statementAvailable === false) return false;
  return !!(
    question.context?.trim() ||
    question.alternativesIntroduction?.trim() ||
    question.alternatives?.some((alternative) => alternative.text?.trim())
  );
}

export default function StudentAIHost() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const hydrated = useHydrated();
  const db = useStore((state) => state.db);
  const mutate = useStore((state) => state.mutate);
  const attempt = db.attempts.find((item) => item.id === id);
  const [current, setCurrent] = useState(0);
  const [selectedFromDom, setSelectedFromDom] = useState<string | null>(null);

  const { data: questions } = useQuery({
    queryKey: ["attempt-questions", id],
    queryFn: () => questionsForAttempt(attempt!),
    enabled: hydrated && !!attempt,
    staleTime: Infinity,
  });

  const syncQuestion = useCallback(() => {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".examContent .qgrid button"),
    );
    const index = buttons.findIndex((button) => button.classList.contains("current"));
    if (index >= 0) setCurrent(index);

    const selectedLetter = document
      .querySelector<HTMLElement>(".examContent .answers button.answer.selected .letter")
      ?.textContent?.trim();
    setSelectedFromDom(selectedLetter || null);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncQuestion);
    const observer = new MutationObserver(syncQuestion);
    const root = document.querySelector(".examContent") || document.body;
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [syncQuestion]);

  const question = questions?.[current];
  const storedSelection = question && attempt ? attempt.answers[questionKey(question)] : null;
  const selectedAnswer = selectedFromDom || storedSelection || null;

  const context = useMemo(() => {
    if (!question || !attempt || !hasUsableText(question)) return null;
    return buildStudentSnapshot(
      db,
      question,
      selectedAnswer,
      attempt.providerId,
      attempt.id,
    );
  }, [db, question, selectedAnswer, attempt]);

  const attemptId = attempt?.id || "";
  const contextQuestionKey = context?.question.key || "";
  const persistAssistance = useCallback(
    (response: AIResponse) => {
      if (!attemptId || !contextQuestionKey) return;
      mutate((draft) => {
        recordStudentAIAssistance(draft, attemptId, contextQuestionKey, response);
      });
    },
    [attemptId, contextQuestionKey, mutate],
  );

  if (!hydrated || !attempt || attempt.strict || !context) return null;
  return (
    <StudentAITutor
      key={context.question.key}
      question={context.question}
      student={context.student}
      onAssistance={persistAssistance}
    />
  );
}
