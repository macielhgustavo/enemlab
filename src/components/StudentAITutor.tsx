"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  BrainCircuit,
  CircleHelp,
  Focus,
  Lightbulb,
  MessageCircle,
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

type AssistanceSurface = "rail" | "selection";

type FloatingAnchor = {
  left: number;
  top: number;
  text?: string;
};

const QUICK_ACTIONS: Array<{
  mode: AIAssistanceMode;
  label: string;
  description: string;
  icon: typeof Lightbulb;
  requiresSelection?: boolean;
}> = [
  {
    mode: "hint",
    label: "Pista",
    description: "Só a direção necessária para continuar.",
    icon: Lightbulb,
  },
  {
    mode: "explain",
    label: "Explicar",
    description: "Desmonta a questão sem transformar tudo em gabarito.",
    icon: BookOpenCheck,
  },
  {
    mode: "guided-solve",
    label: "Resolver comigo",
    description: "Avança por etapas e pede seu raciocínio no caminho.",
    icon: Route,
  },
  {
    mode: "study-needed",
    label: "O que revisar",
    description: "Mostra o conceito que está por trás desta questão.",
    icon: Sparkles,
  },
  {
    mode: "why-wrong",
    label: "Diagnosticar escolha",
    description: "Levanta uma hipótese para o desvio no seu raciocínio.",
    icon: CircleHelp,
    requiresSelection: true,
  },
  {
    mode: "explain-alternative",
    label: "Ler minha alternativa",
    description: "Analisa exatamente a alternativa que você marcou.",
    icon: Target,
    requiresSelection: true,
  },
];

const ASSISTANCE_STAGES: Array<{
  level: AIAssistanceLevel;
  label: string;
  short: string;
  mode: AIAssistanceMode;
  prompt: string;
}> = [
  {
    level: 1,
    label: "Orientação",
    short: "Direção inicial",
    mode: "hint",
    prompt: "Dê apenas uma orientação inicial, sem revelar o caminho completo.",
  },
  {
    level: 2,
    label: "Leitura",
    short: "Entender o pedido",
    mode: "explain",
    prompt: "Ajude a interpretar o enunciado e o que a questão realmente pede.",
  },
  {
    level: 3,
    label: "Conceito",
    short: "Conectar a teoria",
    mode: "explain",
    prompt: "Mostre o conceito central necessário e como reconhecê-lo nesta questão.",
  },
  {
    level: 4,
    label: "Estratégia",
    short: "Escolher o caminho",
    mode: "guided-solve",
    prompt: "Ajude a escolher a estratégia de resolução, sem concluir por mim.",
  },
  {
    level: 5,
    label: "Desenvolvimento",
    short: "Executar comigo",
    mode: "guided-solve",
    prompt: "Conduza o desenvolvimento passo a passo e pare antes da resposta final quando possível.",
  },
  {
    level: 6,
    label: "Resolução",
    short: "Ver a solução completa",
    mode: "guided-solve",
    prompt: "Quero a resolução completa desta questão, com justificativa do resultado final.",
  },
];

const DIAGNOSTIC_LABELS: Record<string, string> = {
  "content-gap": "lacuna de conteúdo",
  interpretation: "interpretação",
  calculation: "cálculo",
  strategy: "estratégia",
  attention: "atenção",
  unknown: "padrão ainda incerto",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  low: "baixa",
  medium: "média",
  high: "alta",
};

function actionMessage(mode: AIAssistanceMode): string {
  const labels: Record<AIAssistanceMode, string> = {
    hint: "Me dê uma pista.",
    explain: "Explique essa questão.",
    "guided-solve": "Resolva comigo, sem pular etapas.",
    "why-wrong": "Analise a alternativa que marquei e diagnostique onde meu raciocínio pode ter desviado.",
    "explain-alternative": "Explique a alternativa que eu marquei e o papel dela nesta questão.",
    "study-needed": "O que preciso estudar para resolver isso?",
    "similar-question": "Crie uma questão parecida.",
    chat: "",
  };
  return labels[mode];
}

function elementFromNode(node: Node | null): HTMLElement | null {
  if (!node) return null;
  if (node instanceof HTMLElement) return node;
  return node.parentElement;
}

function clampPopoverLeft(left: number, width: number): number {
  if (typeof window === "undefined") return left;
  return Math.max(12, Math.min(left, window.innerWidth - width - 12));
}

function responseProviderLabel(response: AIResponse): string {
  if (response.fallbackFrom) return "modo de contingência";
  if (response.provider === "mock") return "simulação local";
  return "modelo ativo";
}

export default function StudentAITutor({
  question,
  student,
  onAssistance,
}: StudentAITutorProps) {
  const [activated, setActivated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [responses, setResponses] = useState<AIResponse[]>([]);
  const [conversation, setConversation] = useState<AIConversationTurn[]>([]);
  const [visibleResponse, setVisibleResponse] = useState<AIResponse | null>(null);
  const [selectionResponse, setSelectionResponse] = useState<AIResponse | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<FloatingAnchor | null>(null);
  const [diagnosticAnchor, setDiagnosticAnchor] = useState<FloatingAnchor | null>(null);
  const [railAnchor, setRailAnchor] = useState({ left: 24, top: 104 });

  const latest = responses[responses.length - 1];
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
    const available = Math.max(0, cardRect.right - contentRect.right);
    const desiredLeft =
      available >= 72
        ? contentRect.right + Math.min(34, Math.max(16, available - 52))
        : cardRect.right - 46;

    setRailAnchor({
      left: Math.max(12, Math.min(desiredLeft, window.innerWidth - 54)),
      top: Math.max(92, Math.min(contentRect.top + 8, window.innerHeight - 380)),
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
    root.dataset.studentAi = activated ? "active" : "idle";
    return () => {
      delete root.dataset.studentAi;
    };
  }, [activated]);

  const ask = useCallback(
    async (
      mode: AIAssistanceMode,
      message?: string,
      requestedLevel?: AIAssistanceLevel,
      surface: AssistanceSurface = "rail",
    ): Promise<AIResponse | null> => {
      const cleanMessage = message?.trim();
      if (mode === "chat" && !cleanMessage) return null;
      if (busy) return null;

      setActivated(true);
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
            requestedLevel,
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
        setResponses((current) => [...current, ai].slice(-8));
        setConversation([...nextConversation, assistantTurn].slice(-10));
        setInput("");

        if (surface === "selection") {
          setSelectionResponse(ai);
        } else {
          setVisibleResponse(ai);
          setMenuOpen(false);
        }
        return ai;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Falha ao consultar o tutor.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [busy, conversation, onAssistance, question, selected, student],
  );

  useEffect(() => {
    function inspectSelection() {
      if (busy) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;

      const range = selection.getRangeAt(0);
      const element = elementFromNode(range.commonAncestorContainer);
      const questionRoot = document.querySelector<HTMLElement>(".examContent #questionContent");
      if (!element || !questionRoot || !questionRoot.contains(element)) return;
      if (element.closest(".answers, button, input, textarea")) return;

      const text = selection.toString().replace(/\s+/g, " ").trim();
      if (text.length < 8 || text.length > 900) return;

      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const popoverHeight = 310;
      const below = rect.bottom + 12;
      const top =
        below + popoverHeight < window.innerHeight
          ? below
          : Math.max(12, rect.top - popoverHeight - 12);

      setActivated(true);
      setMenuOpen(false);
      setSelectionResponse(null);
      setSelectionAnchor({
        left: clampPopoverLeft(rect.left, 390),
        top,
        text,
      });

      void ask(
        "explain",
        `Analise somente este trecho do enunciado, explique a função dele na questão e por que ele importa para a resolução, sem antecipar a resposta final: “${text}”`,
        Math.min(3, Math.max(2, currentLevel || 2)) as AIAssistanceLevel,
        "selection",
      );
    }

    document.addEventListener("mouseup", inspectSelection);
    return () => document.removeEventListener("mouseup", inspectSelection);
  }, [ask, busy, currentLevel]);

  useEffect(() => {
    if (!visibleResponse?.diagnostic || !selected) {
      setDiagnosticAnchor(null);
      return;
    }

    const answers = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".examContent .answers button.answer"),
    );
    const target = answers.find(
      (answer) => answer.querySelector(".letter")?.textContent?.trim() === selected,
    );
    if (!target) return;

    const sync = () => {
      const rect = target.getBoundingClientRect();
      const width = 360;
      const estimatedHeight = 142;
      const below = rect.bottom + 10;
      setDiagnosticAnchor({
        left: clampPopoverLeft(rect.left + 46, width),
        top:
          below + estimatedHeight < window.innerHeight
            ? below
            : Math.max(12, rect.top - estimatedHeight - 10),
      });
    };

    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, { passive: true });
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync);
    };
  }, [selected, visibleResponse]);

  function closeSelection() {
    setSelectionAnchor(null);
    setSelectionResponse(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <>
      <aside
        className={`studentAILayerRail ${activated ? "isActive" : ""}`}
        style={{ left: railAnchor.left, top: railAnchor.top }}
        aria-label="Camada de assistência da questão"
      >
        <button
          type="button"
          className="studentAIOrb"
          onClick={() => {
            setActivated(true);
            setMenuOpen((value) => !value);
          }}
          aria-expanded={menuOpen}
          aria-controls="student-ai-actions"
          title="Abrir Tutor IA"
        >
          <BrainCircuit size={18} />
          <span>Tutor IA</span>
        </button>

        {activated && (
          <div className="studentAIDepth" aria-label="Profundidade da assistência">
            {ASSISTANCE_STAGES.map((stage) => (
              <button
                key={stage.level}
                type="button"
                className={[
                  currentLevel >= stage.level ? "reached" : "",
                  currentLevel === stage.level ? "current" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => void ask(stage.mode, stage.prompt, stage.level)}
                disabled={busy}
                title={`${stage.label} — ${stage.short}`}
                aria-label={`Assistência: ${stage.label}`}
              >
                <i />
                <span>{stage.label}</span>
              </button>
            ))}
          </div>
        )}

        {menuOpen && (
          <section id="student-ai-actions" className="studentAIActionMenu" aria-label="Ações do Tutor IA">
            <header>
              <div className="studentAIEyebrow">
                <ScanText size={13} /> CAMADA INTELIGENTE
              </div>
              <strong>Como você quer avançar?</strong>
              <p>Escolha o tipo de ajuda. A profundidade fica registrada na trilha ao lado.</p>
            </header>

            <div className="studentAIActionGrid">
              {QUICK_ACTIONS.map((action) => {
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
                        : action.description
                    }
                  >
                    <span className="studentAIActionIcon"><Icon size={15} /></span>
                    <span>
                      <b>{action.label}</b>
                      <small>{action.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>

            {!selected && (
              <div className="studentAIContextNote">
                <Focus size={13} /> Marque uma alternativa para liberar a análise da sua escolha.
              </div>
            )}

            <button
              type="button"
              className="studentAIChatToggle"
              onClick={() => setChatOpen((value) => !value)}
              aria-expanded={chatOpen}
            >
              <MessageCircle size={14} /> Perguntar livremente
            </button>

            {chatOpen && (
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
                />
                <button type="submit" disabled={busy || !input.trim()} aria-label="Enviar para o tutor">
                  <Send size={15} />
                </button>
              </form>
            )}
          </section>
        )}

        {visibleResponse && (
          <article className="studentAIInsight" data-level={visibleResponse.level}>
            <button
              type="button"
              className="studentAIClose"
              onClick={() => {
                setVisibleResponse(null);
                setDiagnosticAnchor(null);
              }}
              aria-label="Fechar explicação"
            >
              <X size={15} />
            </button>
            <div className="studentAIEyebrow">
              <Sparkles size={12} /> {ASSISTANCE_STAGES[visibleResponse.level - 1]?.label || "Tutor IA"}
            </div>
            <h3>{visibleResponse.title}</h3>
            <p>{visibleResponse.explanation}</p>
            {!!visibleResponse.concepts.length && (
              <div className="studentAIConcepts">
                {visibleResponse.concepts.map((concept) => (
                  <span key={concept}>{concept}</span>
                ))}
              </div>
            )}
            <div className="studentAINext">
              <span>PRÓXIMO MOVIMENTO</span>
              <b>{visibleResponse.nextStep}</b>
            </div>
            {visibleResponse.revealAnswer && visibleResponse.answer && (
              <div className="studentAIAnswer">
                Resposta revelada <b>{visibleResponse.answer}</b>
              </div>
            )}
            <footer>
              <span>{sourceLabel}</span>
              <span>{responseProviderLabel(visibleResponse)}</span>
            </footer>
          </article>
        )}

        {busy && !selectionAnchor && (
          <div className="studentAILoading" role="status">
            <span /> calibrando a próxima intervenção…
          </div>
        )}

        {error && !selectionAnchor && <div className="studentAIError">{error}</div>}
      </aside>

      {selectionAnchor && (
        <article
          className="studentAISelectionPopover"
          style={{ left: selectionAnchor.left, top: selectionAnchor.top }}
          aria-live="polite"
        >
          <button type="button" className="studentAIClose" onClick={closeSelection} aria-label="Fechar análise do trecho">
            <X size={15} />
          </button>
          <div className="studentAIEyebrow">
            <ScanText size={12} /> LEITURA CONTEXTUAL
          </div>
          <blockquote>“{selectionAnchor.text}”</blockquote>
          {busy && !selectionResponse ? (
            <div className="studentAIInlineLoading">
              <span /> entendendo a função deste trecho…
            </div>
          ) : selectionResponse ? (
            <>
              <h3>{selectionResponse.title}</h3>
              <p>{selectionResponse.explanation}</p>
              {!!selectionResponse.concepts.length && (
                <div className="studentAIConcepts">
                  {selectionResponse.concepts.map((concept) => (
                    <span key={concept}>{concept}</span>
                  ))}
                </div>
              )}
              <div className="studentAISelectionActions">
                <button
                  type="button"
                  onClick={() =>
                    void ask(
                      "explain",
                      `Aprofunde a análise deste trecho sem revelar a resposta final: “${selectionAnchor.text}”`,
                      Math.min(5, selectionResponse.level + 1) as AIAssistanceLevel,
                      "selection",
                    )
                  }
                  disabled={busy}
                >
                  Aprofundar
                </button>
                <span>{selectionResponse.concepts[0] || question.topic}</span>
              </div>
            </>
          ) : (
            <div className="studentAIError">{error || "Não foi possível interpretar este trecho."}</div>
          )}
        </article>
      )}

      {diagnosticAnchor && visibleResponse?.diagnostic && (
        <aside
          className="studentAIDiagnosticBubble"
          style={{ left: diagnosticAnchor.left, top: diagnosticAnchor.top }}
          aria-label="Hipótese diagnóstica sobre a alternativa marcada"
        >
          <div>
            <span>HIPÓTESE</span>
            <b>{DIAGNOSTIC_LABELS[visibleResponse.diagnostic.category] || visibleResponse.diagnostic.category}</b>
          </div>
          <p>{visibleResponse.diagnostic.note}</p>
          <footer>
            confiança {CONFIDENCE_LABELS[visibleResponse.diagnostic.confidence] || visibleResponse.diagnostic.confidence}
          </footer>
        </aside>
      )}
    </>
  );
}
