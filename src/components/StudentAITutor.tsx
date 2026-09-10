"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  BrainCircuit,
  ChevronRight,
  CircleHelp,
  Layers3,
  Lightbulb,
  MessageCircle,
  Pin,
  Route,
  ScanText,
  Send,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import type {
  AIAssistanceLevel,
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

type Stage = {
  level: AIAssistanceLevel;
  label: string;
  description: string;
  mode: AIAssistanceMode;
  message: string;
  icon: typeof Lightbulb;
};

type FloatingAnchor = {
  top: number;
  left: number;
};

type SelectionAnchor = FloatingAnchor & {
  text: string;
};

const STAGES: Stage[] = [
  {
    level: 1,
    label: "Orientação",
    description: "Uma direção mínima para destravar o raciocínio.",
    mode: "hint",
    message: "Dê apenas uma orientação inicial, sem revelar o caminho completo nem a resposta.",
    icon: Lightbulb,
  },
  {
    level: 2,
    label: "Leitura",
    description: "Separe o pedido, as condições e os dados relevantes.",
    mode: "explain",
    message: "Ajude-me a interpretar o enunciado: identifique o objetivo, as condições e os dados relevantes, sem resolver.",
    icon: ScanText,
  },
  {
    level: 3,
    label: "Conceito",
    description: "Conecte a questão ao conhecimento necessário.",
    mode: "explain",
    message: "Mostre qual conceito preciso reconhecer aqui e como ele se conecta ao enunciado, sem resolver a questão.",
    icon: BrainCircuit,
  },
  {
    level: 4,
    label: "Estratégia",
    description: "Escolha um caminho de resolução antes de executar.",
    mode: "explain",
    message: "Ajude-me a montar uma estratégia de resolução e explique por que ela funciona, sem revelar o gabarito.",
    icon: Target,
  },
  {
    level: 5,
    label: "Resolução guiada",
    description: "Avance por etapas preservando minha participação.",
    mode: "guided-solve",
    message: "Resolva comigo passo a passo, parando no próximo movimento útil para eu continuar participando.",
    icon: Route,
  },
  {
    level: 6,
    label: "Resolução",
    description: "Mostre a solução completa quando eu decidir chegar até aqui.",
    mode: "guided-solve",
    message: "Quero a resolução completa desta questão, com justificativa do caminho e da resposta.",
    icon: Layers3,
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  "content-gap": "lacuna de conteúdo",
  interpretation: "interpretação",
  calculation: "cálculo",
  strategy: "estratégia",
  attention: "atenção",
  unknown: "origem incerta",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  low: "baixa",
  medium: "média",
  high: "alta",
};

function responseText(response: AIResponse): string {
  return `${response.title}\n${response.explanation}\n${response.nextStep}`;
}

function clampPopoverLeft(rawLeft: number, width = 390): number {
  if (typeof window === "undefined") return rawLeft;
  const availableWidth = Math.min(width, window.innerWidth - 24);
  return Math.max(12, Math.min(rawLeft, window.innerWidth - availableWidth - 12));
}

function clampPopoverTop(rawTop: number, height = 210): number {
  if (typeof window === "undefined") return rawTop;
  return Math.max(12, Math.min(rawTop, window.innerHeight - height - 12));
}

export default function StudentAITutor({
  question,
  student,
  onAssistance,
}: StudentAITutorProps) {
  const [active, setActive] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [latest, setLatest] = useState<AIResponse | null>(null);
  const [conversation, setConversation] = useState<AIConversationTurn[]>([]);
  const [railAnchor, setRailAnchor] = useState({ left: 24, top: 104 });
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const [selectionResponse, setSelectionResponse] = useState<AIResponse | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionPinned, setSelectionPinned] = useState(false);
  const [diagnosticAnchor, setDiagnosticAnchor] = useState<FloatingAnchor | null>(null);
  const [diagnosticFor, setDiagnosticFor] = useState<string | null>(null);
  const lastSelection = useRef("");
  const selectionRequest = useRef(0);

  const selected = question.selectedAnswer || null;
  const storedLevel = student.currentQuestionAssistance?.maxLevel || 0;
  const currentLevel = Math.max(storedLevel, latest?.level || 0);

  const sourceLabel = useMemo(() => {
    if (question.origin.kind === "official") {
      return `${question.origin.institution} ${question.origin.year} · Q${question.origin.questionNumber}`;
    }
    return question.origin.label;
  }, [question.origin]);

  const syncRailAnchor = useCallback(() => {
    const content = document.querySelector<HTMLElement>(".examContent #questionContent");
    const card = document.querySelector<HTMLElement>(".examContent .questionCard");
    if (!content || !card) return;

    const contentRect = content.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const desiredLeft = Math.min(cardRect.right - 46, contentRect.right + 18);

    setRailAnchor({
      left: Math.max(12, Math.min(desiredLeft, window.innerWidth - 54)),
      top: Math.max(86, Math.min(contentRect.top + 92, window.innerHeight - 390)),
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncRailAnchor);
    window.addEventListener("resize", syncRailAnchor);
    window.addEventListener("scroll", syncRailAnchor, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncRailAnchor);
      window.removeEventListener("scroll", syncRailAnchor);
    };
  }, [syncRailAnchor]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.studentAi = active ? "active" : "idle";
    return () => {
      delete root.dataset.studentAi;
    };
  }, [active]);

  const requestTutor = useCallback(
    async ({
      mode,
      message,
      requestedLevel,
      turns,
    }: {
      mode: AIAssistanceMode;
      message?: string;
      requestedLevel?: AIAssistanceLevel;
      turns?: AIConversationTurn[];
    }): Promise<AIResponse> => {
      const response = await fetch("/api/ai/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          question,
          student,
          message: message?.trim() || undefined,
          requestedLevel,
          selectedAlternative: selected,
          conversation: turns?.slice(-10),
        }),
      });
      const body = (await response.json()) as AIResponse | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body && body.error ? body.error : "Falha ao consultar o tutor.",
        );
      }
      const ai = body as AIResponse;
      onAssistance?.(ai);
      return ai;
    },
    [onAssistance, question, selected, student],
  );

  const ask = useCallback(
    async (mode: AIAssistanceMode, message: string, requestedLevel?: AIAssistanceLevel) => {
      const cleanMessage = message.trim();
      if (!cleanMessage || busy) return;
      setBusy(true);
      setError("");
      setWorkspaceOpen(true);

      const userTurn: AIConversationTurn = { role: "user", content: cleanMessage };
      const nextConversation = [...conversation, userTurn].slice(-10);

      try {
        const ai = await requestTutor({
          mode,
          message: cleanMessage,
          requestedLevel,
          turns: nextConversation,
        });
        const assistantTurn: AIConversationTurn = {
          role: "assistant",
          content: responseText(ai),
        };
        setLatest(ai);
        setConversation([...nextConversation, assistantTurn].slice(-10));
        setInput("");
        if (ai.diagnostic && selected) {
          setDiagnosticFor(selected);
        } else {
          setDiagnosticFor(null);
          setDiagnosticAnchor(null);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Falha ao consultar o tutor.");
      } finally {
        setBusy(false);
      }
    },
    [busy, conversation, requestTutor, selected],
  );

  const analyzeSelection = useCallback(
    async (text: string, level: AIAssistanceLevel = 2) => {
      const requestId = ++selectionRequest.current;
      setSelectionBusy(true);
      setSelectionResponse(null);
      try {
        const ai = await requestTutor({
          mode: "explain",
          requestedLevel: level,
          message: `Analise somente este trecho selecionado da questão: “${text}”. Explique a função dele no raciocínio, o que ele exige que eu perceba e, se houver, uma armadilha de leitura. Não resolva a questão inteira.`,
        });
        if (requestId === selectionRequest.current) setSelectionResponse(ai);
      } catch (cause) {
        if (requestId === selectionRequest.current) {
          setSelectionResponse(null);
          setError(cause instanceof Error ? cause.message : "Falha ao analisar o trecho.");
        }
      } finally {
        if (requestId === selectionRequest.current) setSelectionBusy(false);
      }
    },
    [requestTutor],
  );

  useEffect(() => {
    if (!active) return;

    const captureSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;

      const text = selection.toString().replace(/\s+/g, " ").trim().slice(0, 900);
      if (text.length < 3 || text === lastSelection.current) return;

      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node instanceof Element ? node : node.parentElement;
      if (!element?.closest(".examContent #questionContent")) return;
      if (element.closest(".answers, button, input, textarea")) return;

      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      lastSelection.current = text;
      setSelectionPinned(false);
      setDiagnosticFor(null);
      setDiagnosticAnchor(null);
      setSelectionAnchor({
        text,
        top: clampPopoverTop(rect.bottom + 12, 300),
        left: clampPopoverLeft(rect.left + rect.width / 2 - 195),
      });
      void analyzeSelection(text, 2);
    };

    const onPointerUp = () => window.setTimeout(captureSelection, 20);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift" || event.key.startsWith("Arrow")) {
        window.setTimeout(captureSelection, 20);
      }
    };
    const dismissOnViewportChange = () => {
      if (!selectionPinned) setSelectionAnchor(null);
    };

    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", dismissOnViewportChange);
    window.addEventListener("scroll", dismissOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", dismissOnViewportChange);
      window.removeEventListener("scroll", dismissOnViewportChange, true);
    };
  }, [active, analyzeSelection, selectionPinned]);

  useEffect(() => {
    if (!active || !latest?.diagnostic || !diagnosticFor || selected !== diagnosticFor) return;

    const answers = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".examContent .answers button.answer"),
    );
    const target = answers.find(
      (answer) => answer.querySelector(".letter")?.textContent?.trim() === diagnosticFor,
    );
    if (!target) return;

    const position = () => {
      const rect = target.getBoundingClientRect();
      setDiagnosticAnchor({
        top: clampPopoverTop(rect.bottom + 10, 150),
        left: clampPopoverLeft(rect.left + 46, 390),
      });
    };

    const frame = window.requestAnimationFrame(position);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position);
    };
  }, [active, diagnosticFor, latest, selected]);

  function deactivateLayer() {
    setActive(false);
    setWorkspaceOpen(false);
    setComposerOpen(false);
    setSelectionAnchor(null);
    setSelectionResponse(null);
    setSelectionPinned(false);
    setDiagnosticAnchor(null);
    setDiagnosticFor(null);
    lastSelection.current = "";
    window.getSelection()?.removeAllRanges();
  }

  function keepSelectionInWorkspace() {
    if (!selectionResponse) return;
    setLatest(selectionResponse);
    setWorkspaceOpen(true);
    setSelectionPinned(false);
    setSelectionAnchor(null);
    lastSelection.current = "";
    window.getSelection()?.removeAllRanges();
  }

  return (
    <>
      {!active ? (
        <button type="button" className="studentAIActivator" onClick={() => setActive(true)}>
          <span className="studentAIActivatorIcon">
            <Sparkles size={16} />
          </span>
          <span>
            <b>Ativar camada IA</b>
            <small>ajuda contextual, sem tirar você da questão</small>
          </span>
          <ChevronRight size={15} />
        </button>
      ) : (
        <>
          <aside
            className="studentAIRail"
            style={{ left: railAnchor.left, top: railAnchor.top }}
            aria-label="Profundidade da assistência da IA"
          >
            <div className="studentAIRailMark" aria-hidden="true">
              <Sparkles size={14} />
            </div>
            <div className="studentAIRailLine" aria-hidden="true" />
            {STAGES.map((stage) => {
              const Icon = stage.icon;
              const status =
                currentLevel > stage.level
                  ? "complete"
                  : currentLevel === stage.level
                    ? "current"
                    : "future";
              return (
                <button
                  key={stage.level}
                  type="button"
                  className="studentAIRailStage"
                  data-status={status}
                  onClick={() => void ask(stage.mode, stage.message, stage.level)}
                  disabled={busy}
                  aria-label={`${stage.label}: ${stage.description}`}
                  title={`${stage.label} — ${stage.description}`}
                >
                  <span className="studentAIRailNode">
                    <Icon size={13} />
                  </span>
                  <span className="studentAIRailLabel">
                    <b>{stage.label}</b>
                    <small>{stage.description}</small>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              className="studentAIRailWorkspace"
              onClick={() => setWorkspaceOpen((value) => !value)}
              aria-expanded={workspaceOpen}
            >
              <MessageCircle size={14} />
              <span>Raciocínio</span>
            </button>
          </aside>

          <div className="studentAIStatus" aria-label="Camada IA ativa">
            <button type="button" onClick={() => setWorkspaceOpen((value) => !value)}>
              <Sparkles size={14} />
              <span>
                <b>Camada IA</b>
                <small>{currentLevel ? STAGES[currentLevel - 1]?.label : "pronta"}</small>
              </span>
            </button>
            <button type="button" onClick={deactivateLayer} aria-label="Desativar camada IA">
              <X size={15} />
            </button>
          </div>
        </>
      )}

      {active && workspaceOpen && (
        <section className="studentAIWorkspace" aria-label="Raciocínio guiado da questão">
          <header className="studentAIWorkspaceHead">
            <div>
              <span>RACIOCÍNIO GUIADO</span>
              <h2>{currentLevel ? STAGES[currentLevel - 1]?.label : "Comece pela questão"}</h2>
            </div>
            <button
              type="button"
              onClick={() => setWorkspaceOpen(false)}
              aria-label="Fechar raciocínio"
            >
              <X size={16} />
            </button>
          </header>

          <div className="studentAIWorkspaceMeta">
            <span>{sourceLabel}</span>
            <span>
              {question.subject} · {question.topic}
            </span>
          </div>

          <div className="studentAIDepthMeter" aria-label="Profundidade da ajuda">
            {STAGES.map((stage) => (
              <span
                key={stage.level}
                className={currentLevel >= stage.level ? "active" : ""}
                title={stage.label}
              />
            ))}
          </div>

          {selected && (
            <div className="studentAISelectedActions">
              <div>
                <span>SUA ESCOLHA · {selected}</span>
                <small>Teste o raciocínio sem transformar a análise em gabarito.</small>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void ask(
                    "explain-alternative",
                    "Analise a alternativa que marquei. Diga se meu raciocínio faz sentido e, se houver um desvio sustentado pelo contexto, explique-o sem revelar a letra correta.",
                    4,
                  )
                }
              >
                <CircleHelp size={13} />
                Analisar escolha
              </button>
            </div>
          )}

          {!latest && !busy && !error && (
            <div className="studentAIEmptyState">
              <ScanText size={18} />
              <b>A inteligência fica na questão, não em um chat.</b>
              <p>
                Use a trilha para escolher a profundidade da ajuda ou selecione qualquer trecho
                do enunciado para receber uma leitura contextual naquele ponto.
              </p>
            </div>
          )}

          {busy && (
            <div className="studentAIThinking">
              <span />
              <div>
                <b>Construindo a próxima intervenção</b>
                <small>A resposta respeita a profundidade escolhida.</small>
              </div>
            </div>
          )}

          {error && <div className="studentAIError">{error}</div>}

          {latest && !busy && (
            <article className="studentAIInsight" data-level={latest.level}>
              <div className="studentAIInsightEyebrow">
                <span>{STAGES[latest.level - 1]?.label || `Nível ${latest.level}`}</span>
                <small>
                  {latest.fallbackFrom
                    ? `contingência · ${latest.fallbackFrom} → mock`
                    : latest.provider === "mock"
                      ? "modo de desenvolvimento"
                      : latest.provider}
                </small>
              </div>
              <h3>{latest.title}</h3>
              <p>{latest.explanation}</p>

              {!!latest.concepts.length && (
                <div className="studentAIConcepts">
                  {latest.concepts.map((concept, index) => (
                    <span key={`${concept}-${index}`}>{concept}</span>
                  ))}
                </div>
              )}

              <div className="studentAINextStep">
                <span>PRÓXIMO MOVIMENTO</span>
                <p>{latest.nextStep}</p>
              </div>

              {latest.revealAnswer && latest.answer && (
                <div className="studentAIRevealedAnswer">
                  <span>RESPOSTA REVELADA</span>
                  <b>{latest.answer}</b>
                </div>
              )}

              {latest.generatedQuestion && (
                <div className="studentAIGenerated">
                  <span>{latest.generatedQuestion.label}</span>
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

          <div className="studentAIWorkspaceFooter">
            <button
              type="button"
              className="studentAIFreeQuestion"
              onClick={() => setComposerOpen((value) => !value)}
              aria-expanded={composerOpen}
            >
              <MessageCircle size={14} />
              Fazer uma pergunta livre
              <ChevronRight size={13} />
            </button>

            {composerOpen && (
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
                  placeholder="Pergunte sobre esta questão…"
                  disabled={busy}
                  aria-label="Mensagem para o tutor IA"
                  autoFocus
                />
                <button type="submit" disabled={busy || !input.trim()} aria-label="Enviar pergunta">
                  <Send size={15} />
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      {active && selectionAnchor && (
        <section
          className="studentAISelectionPopover"
          style={{ top: selectionAnchor.top, left: selectionAnchor.left }}
          aria-live="polite"
        >
          <header>
            <div>
              <span>LEITURA CONTEXTUAL</span>
              <small>
                “{selectionAnchor.text.slice(0, 120)}
                {selectionAnchor.text.length > 120 ? "…" : ""}”
              </small>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectionAnchor(null);
                setSelectionPinned(false);
                lastSelection.current = "";
                window.getSelection()?.removeAllRanges();
              }}
              aria-label="Fechar análise do trecho"
            >
              <X size={14} />
            </button>
          </header>

          {selectionBusy ? (
            <div className="studentAISelectionLoading">
              <span />
              Interpretando a função deste trecho…
            </div>
          ) : selectionResponse ? (
            <>
              <div className="studentAISelectionBody">
                <b>{selectionResponse.title}</b>
                <p>{selectionResponse.explanation}</p>
              </div>
              {!!selectionResponse.concepts.length && (
                <div className="studentAISelectionChips">
                  {selectionResponse.concepts.slice(0, 4).map((concept, index) => (
                    <span key={`${concept}-${index}`}>{concept}</span>
                  ))}
                </div>
              )}
              <div className="studentAISelectionActions">
                <button
                  type="button"
                  onClick={() => void analyzeSelection(selectionAnchor.text, 3)}
                >
                  <ArrowUpRight size={13} /> Aprofundar
                </button>
                <button type="button" onClick={() => setSelectionPinned(true)}>
                  <Pin size={13} /> {selectionPinned ? "Fixado" : "Fixar"}
                </button>
                <button type="button" onClick={keepSelectionInWorkspace}>
                  <BrainCircuit size={13} /> Levar ao raciocínio
                </button>
              </div>
            </>
          ) : (
            <div className="studentAISelectionLoading">Não foi possível analisar este trecho.</div>
          )}
        </section>
      )}

      {active &&
        latest?.diagnostic &&
        diagnosticAnchor &&
        selected === diagnosticFor && (
          <aside
            className="studentAIDiagnostic"
            style={{ top: diagnosticAnchor.top, left: diagnosticAnchor.left }}
            aria-label="Hipótese diagnóstica da alternativa marcada"
          >
            <div className="studentAIDiagnosticIcon">
              <CircleHelp size={14} />
            </div>
            <div>
              <span>
                POSSÍVEL DESVIO · CONFIANÇA {CONFIDENCE_LABELS[latest.diagnostic.confidence] || latest.diagnostic.confidence}
              </span>
              <b>{CATEGORY_LABELS[latest.diagnostic.category] || latest.diagnostic.category}</b>
              <p>{latest.diagnostic.note}</p>
            </div>
          </aside>
        )}
    </>
  );
}
