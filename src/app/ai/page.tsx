"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  ChevronRight,
  Clock3,
  Gauge,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { useActiveProvider } from "@/components/ExamSwitch";
import { LoadingState } from "@/components/enem-lab/states";
import { useHydrated } from "@/lib/hooks";
import { buildDailyPlan } from "@/lib/domain/daily-plan";
import { isHighStudentAIAssistance } from "@/lib/domain/ai-assistance";
import { officialRowsOf } from "@/lib/domain/stats";
import type {
  DB,
  StudentAIDiagnosticCategory,
  StudentAIDiagnosticConfidence,
} from "@/lib/domain/types";
import { sameProvider } from "@/lib/providers/registry";
import { useStore } from "@/lib/store";

const BUDGET_KEY = "enem_lab_daily_minutes";

const DIAGNOSTIC_META: Record<
  Exclude<StudentAIDiagnosticCategory, "unknown">,
  { label: string; short: string }
> = {
  interpretation: { label: "Interpretação", short: "leitura do comando e contexto" },
  "content-gap": { label: "Conteúdo", short: "conceito ainda não consolidado" },
  calculation: { label: "Cálculo", short: "execução algébrica ou numérica" },
  strategy: { label: "Estratégia", short: "escolha do caminho de resolução" },
  attention: { label: "Atenção", short: "sinal fraco; não dirige o plano sozinho" },
};

const CONFIDENCE_LABEL: Record<StudentAIDiagnosticConfidence, string> = {
  low: "baixa",
  medium: "média",
  high: "alta",
};

type LearningEvent = {
  id: string;
  at: string;
  kind: "diagnostic" | "positive";
  eyebrow: string;
  title: string;
  detail: string;
  confidence?: StudentAIDiagnosticConfidence;
};

function pct(correct: number, total: number): number | null {
  return total ? Math.round((correct / total) * 100) : null;
}

function traceForRow(db: DB, attemptId: string, key: string) {
  return db.attempts.find((attempt) => attempt.id === attemptId)?.aiAssistance?.[key];
}

function independentAccuracy(
  db: DB,
  rows: ReturnType<typeof officialRowsOf>,
): { correct: number; total: number; accuracy: number | null } {
  const independent = rows.filter(
    (row) => !isHighStudentAIAssistance(traceForRow(db, row.attemptId, row.key)),
  );
  const valid = independent.filter((row) => typeof row.isCorrect === "boolean");
  const correct = valid.filter((row) => row.isCorrect).length;
  return { correct, total: valid.length, accuracy: pct(correct, valid.length) };
}

function collectLearningEvents(db: DB, providerId: string): LearningEvent[] {
  const events: LearningEvent[] = [];

  for (const attempt of db.attempts) {
    if (!attempt.aiAssistance || !sameProvider(attempt.providerId, providerId)) continue;
    for (const [key, trace] of Object.entries(attempt.aiAssistance)) {
      const row = attempt.result?.rows.find((candidate) => candidate.key === key);
      for (const event of trace.recent) {
        const diagnostic = event.diagnostic;
        if (!diagnostic || diagnostic.category === "unknown") continue;
        const meta = DIAGNOSTIC_META[diagnostic.category];
        events.push({
          id: `${attempt.id}-${key}-${event.at}-${diagnostic.category}`,
          at: event.at,
          kind: "diagnostic",
          eyebrow: `Hipótese · confiança ${CONFIDENCE_LABEL[diagnostic.confidence]}`,
          title: meta.label,
          detail: row?.content ? `${row.content} · ${meta.short}` : meta.short,
          confidence: diagnostic.confidence,
        });
      }
    }
  }

  const rows = officialRowsOf(db, providerId).filter(
    (row) => typeof row.isCorrect === "boolean" && !!row.finishedAt,
  );
  const independent = rows.filter(
    (row) => !isHighStudentAIAssistance(traceForRow(db, row.attemptId, row.key)),
  );

  if (independent.length >= 12) {
    const recent = independent.slice(-6);
    const previous = independent.slice(-12, -6);
    const recentAccuracy = pct(recent.filter((row) => row.isCorrect).length, recent.length) || 0;
    const previousAccuracy = pct(previous.filter((row) => row.isCorrect).length, previous.length) || 0;
    const delta = recentAccuracy - previousAccuracy;
    if (delta >= 10) {
      events.push({
        id: `positive-accuracy-${recent.at(-1)?.finishedAt}`,
        at: recent.at(-1)?.finishedAt || new Date(0).toISOString(),
        kind: "positive",
        eyebrow: "Evidência independente",
        title: `Precisão recente +${delta} p.p.`,
        detail: `${recentAccuracy}% nas últimas 6 questões sem assistência alta, contra ${previousAccuracy}% nas 6 anteriores.`,
      });
    }
  }

  let streak = 0;
  for (let index = independent.length - 1; index >= 0; index--) {
    if (independent[index].isCorrect) streak++;
    else break;
  }
  if (streak >= 3) {
    const last = independent.at(-1);
    events.push({
      id: `positive-streak-${last?.finishedAt}`,
      at: last?.finishedAt || new Date(0).toISOString(),
      kind: "positive",
      eyebrow: "Consistência",
      title: `${streak} acertos independentes consecutivos`,
      detail: "A sequência considera apenas questões sem assistência alta do Tutor IA.",
    });
  }

  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 7);
}

function rollingTrend(values: boolean[]): string {
  if (values.length < 2) return "";
  const rolling = values.map((_, index) => {
    const window = values.slice(Math.max(0, index - 4), index + 1);
    return pct(window.filter(Boolean).length, window.length) || 0;
  });
  return rolling
    .map((value, index) => {
      const x = (index / Math.max(1, rolling.length - 1)) * 100;
      const y = 38 - (value / 100) * 30;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function recommendationStrength(priority?: number): string {
  if (!priority) return "exploratória";
  if (priority <= 2) return "alta";
  if (priority <= 4) return "média";
  return "exploratória";
}

function formatEventDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recente";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  })
    .format(date)
    .replace(" de ", " ");
}

export default function AICenterPage() {
  const db = useStore((state) => state.db);
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  const [now] = useState(() => new Date());
  const [budget] = useState(() => {
    if (typeof window === "undefined") return 60;
    try {
      const stored = Number(localStorage.getItem(BUDGET_KEY));
      return stored >= 20 ? stored : 60;
    } catch {
      return 60;
    }
  });

  const rows = useMemo(
    () => officialRowsOf(db, providerId).filter((row) => typeof row.isCorrect === "boolean"),
    [db, providerId],
  );
  const events = useMemo(() => collectLearningEvents(db, providerId), [db, providerId]);

  if (!hydrated) {
    return (
      <div className="aiCenterLoading">
        <LoadingState lines={6} label="Montando sua camada de inteligência" />
      </div>
    );
  }

  const plan = buildDailyPlan(db, budget, now, providerId);
  const next = plan.blocks[0];
  const latestRows = rows.slice(-24);
  const raw = {
    correct: latestRows.filter((row) => row.isCorrect).length,
    total: latestRows.length,
  };
  const independent = independentAccuracy(db, latestRows);
  const highAssistance = latestRows.filter((row) =>
    isHighStudentAIAssistance(traceForRow(db, row.attemptId, row.key)),
  ).length;
  const trendPoints = rollingTrend(latestRows.map((row) => !!row.isCorrect));

  const diagnosticCounts = Object.keys(DIAGNOSTIC_META).reduce<Record<string, number>>(
    (acc, category) => {
      acc[category] = db.attempts
        .filter((attempt) => sameProvider(attempt.providerId, providerId))
        .flatMap((attempt) => Object.values(attempt.aiAssistance || {}))
        .flatMap((trace) => trace.recent)
        .filter(
          (event) =>
            event.diagnostic?.category === category && event.diagnostic.confidence === "high",
        ).length;
      return acc;
    },
    {},
  );
  const diagnosticMax = Math.max(1, ...Object.values(diagnosticCounts));

  const recommendedKind = next?.kind || "adaptive";
  const evidence = [
    {
      label: "Retenção",
      value: `${plan.signals.dueReviews} pendente${plan.signals.dueReviews === 1 ? "" : "s"}`,
      detail: "revisões vencidas agora",
      active: recommendedKind === "srs",
      icon: RotateCcw,
    },
    {
      label: "Independência",
      value: `${plan.signals.assistedTopicsToValidate} tópico${plan.signals.assistedTopicsToValidate === 1 ? "" : "s"}`,
      detail: "pedindo validação sem IA",
      active: recommendedKind === "validation",
      icon: Target,
    },
    {
      label: "Erro crítico",
      value: `${plan.signals.highConfidenceErrors}`,
      detail: "erros recentes respondidos com certeza",
      active: recommendedKind === "weak",
      icon: Gauge,
    },
    {
      label: "Ritmo semanal",
      value: `${plan.signals.weeklyQuestions}/${plan.signals.weeklyTarget || "—"}`,
      detail: plan.signals.paceDeficit
        ? `${plan.signals.paceDeficit} abaixo do ritmo esperado`
        : "ritmo esperado em dia",
      active: recommendedKind === "adaptive" || recommendedKind === "unseen",
      icon: Activity,
    },
  ];

  return (
    <div className="aiCenterPage">
      <header className="aiCenterHead">
        <div>
          <div className="aiCenterEyebrow"><BrainCircuit size={14} /> ENEMLAB INTELLIGENCE</div>
          <h1>Seu sistema de aprendizagem.</h1>
          <p>
            A IA não fica esperando uma pergunta. Ela cruza retenção, desempenho, assistência e padrão de erros para decidir qual é o próximo movimento mais útil.
          </p>
        </div>
        <div className="aiCenterStatus">
          <span><i /> contexto ativo</span>
          <b>{rows.length}</b>
          <small>questões na base pessoal desta prova</small>
        </div>
      </header>

      <section className="aiNextBest" aria-labelledby="ai-next-title">
        <div className="aiNextBestMain">
          <div className="aiNextBestTop">
            <div>
              <span>PRÓXIMA MELHOR AÇÃO</span>
              <small>força da recomendação · {recommendationStrength(next?.priority)}</small>
            </div>
            <Sparkles size={18} />
          </div>

          <h2 id="ai-next-title">{next?.title || "Ampliar a amostra adaptativa"}</h2>
          <p>
            {next?.reason ||
              "Nenhum gargalo forte está dominando o seu histórico agora. Uma sessão adaptativa gera evidência nova para encontrar a próxima prioridade."}
          </p>

          <div className="aiNextBestMetrics">
            <div>
              <Clock3 size={14} />
              <span>tempo</span>
              <b>{next?.minutes || Math.min(30, plan.remainingMinutes || 30)} min</b>
            </div>
            <div>
              <Target size={14} />
              <span>amostra</span>
              <b>{next?.questions || 10} questões</b>
            </div>
            <div>
              <Activity size={14} />
              <span>sinal</span>
              <b>{next?.eyebrow || "calibração"}</b>
            </div>
          </div>

          <div className="aiNextBestActions">
            <Link href={next ? "/plano" : "/adaptive"} className="aiPrimaryAction">
              {next ? "Abrir recomendação" : "Abrir Adaptive"} <ArrowRight size={15} />
            </Link>
            <span>O motor recalcula depois de cada sessão concluída.</span>
          </div>
        </div>

        <div className="aiNextBestSignal" aria-label="Tendência recente de desempenho">
          <div className="aiSignalHead">
            <span>PRECISÃO RECENTE</span>
            <b>{pct(raw.correct, raw.total) ?? "—"}%</b>
          </div>
          <div className="aiTrendChart" aria-hidden="true">
            {trendPoints ? (
              <svg viewBox="0 0 100 44" preserveAspectRatio="none">
                <line x1="0" y1="23" x2="100" y2="23" />
                <polyline points={trendPoints} />
              </svg>
            ) : (
              <div className="aiTrendEmpty">amostra insuficiente</div>
            )}
          </div>
          <div className="aiSignalCompare">
            <div>
              <small>independente</small>
              <b>{independent.accuracy ?? "—"}%</b>
              <span>{independent.total} questões</span>
            </div>
            <div>
              <small>assistência alta</small>
              <b>{highAssistance}</b>
              <span>nas últimas {latestRows.length || 0}</span>
            </div>
          </div>
        </div>

        <details className="aiWhy">
          <summary>
            <span>
              <BrainCircuit size={14} /> Por que isso foi recomendado?
            </span>
            <ChevronRight size={15} />
          </summary>
          <div className="aiEvidenceGrid">
            {evidence.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className={item.active ? "active" : ""}>
                  <Icon size={15} />
                  <span>{item.label}</span>
                  <b>{item.value}</b>
                  <small>{item.detail}</small>
                </div>
              );
            })}
          </div>
        </details>
      </section>

      <div className="aiCenterGrid">
        <section className="aiLearningTimeline" aria-labelledby="learning-timeline-title">
          <header className="aiSectionHead">
            <div>
              <span>TRAJETÓRIA</span>
              <h2 id="learning-timeline-title">O que está mudando no seu aprendizado</h2>
            </div>
            <Link href="/review">Ver erros <ChevronRight size={14} /></Link>
          </header>

          {events.length ? (
            <div className="aiTimeline">
              {events.map((event) => (
                <article key={event.id} className={event.kind}>
                  <time>{formatEventDate(event.at)}</time>
                  <i />
                  <div>
                    <span>{event.eyebrow}</span>
                    <h3>{event.title}</h3>
                    <p>{event.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="aiEmptyState">
              <TrendingUp size={20} />
              <b>Ainda não há trajetória suficiente.</b>
              <p>
                Conforme você usa o Tutor IA e resolve questões, diagnósticos e viradas de desempenho aparecem aqui sem inventar conclusões com amostra pequena.
              </p>
            </div>
          )}
        </section>

        <section className="aiPatternMap" aria-labelledby="pattern-map-title">
          <header className="aiSectionHead">
            <div>
              <span>MAPA DE PADRÕES</span>
              <h2 id="pattern-map-title">Hipóteses de erro com alta confiança</h2>
            </div>
          </header>

          <div className="aiPatternList">
            {Object.entries(DIAGNOSTIC_META).map(([category, meta]) => {
              const count = diagnosticCounts[category] || 0;
              return (
                <div key={category}>
                  <div className="aiPatternRow">
                    <span>{meta.label}</span>
                    <b>{count}</b>
                  </div>
                  <div className="aiPatternTrack" aria-hidden="true">
                    <span style={{ width: `${(count / diagnosticMax) * 100}%` }} />
                  </div>
                  <small>{meta.short}</small>
                </div>
              );
            })}
          </div>

          <div className="aiPatternFoot">
            <BrainCircuit size={15} />
            <p>
              Só diagnósticos de <b>alta confiança</b> entram neste mapa. “Atenção” continua com peso baixo e não força revisão sozinho.
            </p>
          </div>
        </section>
      </div>

      <section className="aiLearningMode" aria-labelledby="ai-learning-mode-title">
        <div className="aiLearningModeCopy">
          <span>APRENDER COM IA</span>
          <h2 id="ai-learning-mode-title">Aulas guiadas, não uma conversa infinita.</h2>
          <p>
            A próxima evolução deste centro usa uma sequência vertical de conteúdo, exemplo, checkpoint e prática. A IA explica quando muda o caminho e o chat livre permanece disponível apenas para dúvidas dentro da aula.
          </p>
          <div className="aiLearningModeLinks">
            <Link href="/mastery">Escolher pelo domínio <ArrowRight size={14} /></Link>
            <Link href="/practice">Começar por uma questão</Link>
          </div>
        </div>

        <div className="aiLessonPreview" aria-label="Estrutura planejada para aulas guiadas">
          <div className="active"><i>01</i><span><b>Contexto</b><small>o que você precisa entender primeiro</small></span></div>
          <div><i>02</i><span><b>Conceito</b><small>explicação curta e conectada</small></span></div>
          <div><i>03</i><span><b>Exemplo</b><small>aplicação antes da prática</small></span></div>
          <div><i>04</i><span><b>Checkpoint</b><small>a IA decide se avança ou reforça</small></span></div>
          <div><i>05</i><span><b>Prática</b><small>evidência independente de domínio</small></span></div>
        </div>
      </section>

      <nav className="aiCenterLinks" aria-label="Áreas conectadas à inteligência">
        <Link href="/plano">
          <Sparkles size={16} />
          <span><b>Plano inteligente</b><small>prioridades e blocos do dia</small></span>
          <ChevronRight size={15} />
        </Link>
        <Link href="/review">
          <Target size={16} />
          <span><b>Erros</b><small>investigar padrões questão a questão</small></span>
          <ChevronRight size={15} />
        </Link>
        <Link href="/mastery">
          <BookOpenCheck size={16} />
          <span><b>Domínio</b><small>amostra e confiança por conteúdo</small></span>
          <ChevronRight size={15} />
        </Link>
      </nav>
    </div>
  );
}
