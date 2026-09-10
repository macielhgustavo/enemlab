"use client";

import { useMemo, useState } from "react";
import {
  BookOpenCheck,
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Lightbulb,
  MessageCircle,
  Route,
  Send,
  Sparkles,
} from "lucide-react";
import type {
  AIAssistanceMode,
  AIConversationTurn,
  AIQuestionContext,
  AIResponse,
  AIStudentSnapshot,
} from "@/lib/ai/types";

interface StudentAITutorProps {
  question: AIQuestionContext;
  student: AIStudentSnapshot;
  onAssistance?: (response: AIResponse) => void;
}

const ACTIONS: Array<{
  mode: AIAssistanceMode;
  label: string;
  icon: typeof Lightbulb;
  requiresSelection?: boolean;
}> = [
  { mode: "hint", label: "Me dê uma pista", icon: Lightbulb },
  { mode: "explain", label: "Explique a questão", icon: BookOpenCheck },
  { mode: "guided-solve", label: "Resolva comigo", icon: Route },
  {
    mode: "why-wrong",
    label: "Por que minha resposta está errada?",
    icon: CircleHelp,
    requiresSelection: true,
  },
  {
    mode: "explain-alternative",
    label: "Explique minha alternativa",
    icon: MessageCircle,
    requiresSelection: true,
  },
  { mode: "study-needed", label: "O que preciso estudar?", icon: Sparkles },
  { mode: "similar-question", label: "Crie uma questão parecida", icon: BrainCircuit },
];

function actionMessage(mode: AIAssistanceMode): string {
  const labels: Record<AIAssistanceMode, string> = {
    hint: "Me dê uma pista.",
    explain: "Explique essa questão.",
    "guided-solve": "Resolva comigo, sem pular etapas.",
    "why-wrong": "Por que minha resposta está errada?",
    "explain-alternative": "Explique a alternativa que eu marquei.",
    "study-needed": "O que preciso estudar para resolver isso?",
    "similar-question": "Crie uma questão parecida.",
    chat: "",
  };
  return labels[mode];
}

export default function StudentAITutor({
  question,
  student,
  onAssistance,
}: StudentAITutorProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [responses, setResponses] = useState<AIResponse[]>([]);
  const [conversation, setConversation] = useState<AIConversationTurn[]>([]);

  const latest = responses[responses.length - 1];
  const selected = question.selectedAnswer || null;
  const sourceLabel = useMemo(() => {
    if (question.origin.kind === "official") {
      return `${question.origin.institution} ${question.origin.year} · Q${question.origin.questionNumber}`;
    }
    return question.origin.label;
  }, [question.origin]);

  async function ask(mode: AIAssistanceMode, message?: string) {
    const cleanMessage = message?.trim();
    if (mode === "chat" && !cleanMessage) return;
    setBusy(true);
    setError("");

    const userContent = cleanMessage || actionMessage(mode);
    const userTurn: AIConversationTurn = { role: "user", content: userContent };
    const nextConversation = [...conversation, userTurn].slice(-10);

    try {
      const response = await fetch("/api/ai/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          question,
          student,
          message: cleanMessage,
          selectedAlternative: selected,
          conversation: nextConversation,
        }),
      });
      const body = (await response.json()) as AIResponse | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body && body.error ? body.error : "Falha ao consultar o tutor.",
        );
      }

      const ai = body as AIResponse;
      const assistantTurn: AIConversationTurn = {
        role: "assistant",
        content: `${ai.title}\n${ai.explanation}\n${ai.nextStep}`,
      };
      onAssistance?.(ai);
      setResponses((current) => [...current, ai].slice(-6));
      setConversation([...nextConversation, assistantTurn].slice(-10));
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao consultar o tutor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`studentAI ${open ? "open" : ""}`}>
      <button
        type="button"
        className="studentAITrigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="student-ai-panel"
      >
        <span className="studentAITriggerIcon">
          <BrainCircuit size={18} />
        </span>
        <span>
          <b>Tutor IA</b>
          <small>{question.topic}</small>
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>

      {open && (
        <section id="student-ai-panel" className="studentAIPanel" aria-label="Tutor IA da questão">
          <header className="studentAIHead">
            <div>
              <span>ASSISTÊNCIA CONTEXTUAL</span>
              <b>{sourceLabel}</b>
            </div>
            <small>
              {question.subject} · {question.topic}
            </small>
          </header>

          <div className="studentAIActions">
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              const disabled = busy || (!!action.requiresSelection && !selected);
              return (
                <button
                  key={action.mode}
                  type="button"
                  onClick={() => void ask(action.mode)}
                  disabled={disabled}
                  title={
                    action.requiresSelection && !selected
                      ? "Marque uma alternativa primeiro"
                      : action.label
                  }
                >
                  <Icon size={14} />
                  {action.label}
                </button>
              );
            })}
          </div>

          {!selected && (
            <div className="studentAISelectionHint">
              Marque uma alternativa para liberar a análise específica da sua resposta.
            </div>
          )}

          {busy && (
            <div className="studentAILoading">
              <span />
              Preparando uma ajuda no nível certo…
            </div>
          )}

          {error && <div className="studentAIError">{error}</div>}

          {latest && !busy && (
            <article className="studentAIResponse" data-mode={latest.mode} data-level={latest.level}>
              <div className="studentAIResponseTop">
                <div>
                  <span>NÍVEL {latest.level}/6</span>
                  <h3>{latest.title}</h3>
                </div>
                <small>
                  {latest.fallbackFrom
                    ? `contingência · ${latest.fallbackFrom} → mock`
                    : latest.provider === "mock"
                      ? "modo de desenvolvimento"
                      : latest.provider}
                </small>
              </div>
              <p>{latest.explanation}</p>
              {!!latest.concepts.length && (
                <div className="studentAIConcepts">
                  {latest.concepts.map((concept) => (
                    <span key={concept}>{concept}</span>
                  ))}
                </div>
              )}
              <div className="studentAINext">
                <b>Próximo passo</b>
                <span>{latest.nextStep}</span>
              </div>
              {latest.diagnostic && (
                <div className="studentAISelectionHint">
                  Sinal diagnóstico ({latest.diagnostic.confidence}): {latest.diagnostic.note}
                </div>
              )}
              {latest.revealAnswer && latest.answer && (
                <div className="studentAIAnswer">
                  Resposta revelada: <b>{latest.answer}</b>
                </div>
              )}
              {latest.generatedQuestion && (
                <div className="studentAIGenerated">
                  <strong>{latest.generatedQuestion.label}</strong>
                  <p>{latest.generatedQuestion.statement}</p>
                  {latest.generatedQuestion.alternatives.map((alternative) => (
                    <div key={alternative.letter}>
                      <b>{alternative.letter}</b> {alternative.text}
                    </div>
                  ))}
                </div>
              )}
            </article>
          )}

          <form
            className="studentAIComposer"
            onSubmit={(event) => {
              event.preventDefault();
              void ask("chat", input);
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Pergunte qualquer coisa sobre esta questão…"
              disabled={busy}
              aria-label="Mensagem para o tutor IA"
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Enviar para o tutor">
              <Send size={15} />
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
