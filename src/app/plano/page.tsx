"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BrainCircuit, Clock3, Gauge, RotateCcw, Sparkles, Target } from "lucide-react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { useActiveProvider } from "@/components/ExamSwitch";
import { pct } from "@/lib/format";
import { areasOf } from "@/lib/providers/taxonomy";
import { areaStats, wilsonInterval } from "@/lib/domain/stats";
import { buildDailyPlan, type DailyPlanBlock } from "@/lib/domain/daily-plan";
import {
  buildAdaptiveAttempt,
  buildContentSprintAttempt,
  buildDueReviewsAttempt,
  buildTrainingAttempt,
} from "@/lib/services/attempts";
import { Card, PageHead } from "@/components/ui";
import type { Attempt } from "@/lib/domain/types";

const BUDGET_KEY = "enem_lab_daily_minutes";
const BUDGET_PRESETS = [30, 45, 60, 90, 120];

export default function PlanoPage() {
  const db = useStore((s) => s.db);
  const addAttempt = useStore((s) => s.addAttempt);
  const router = useRouter();
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  const [now] = useState(() => new Date());
  const [budget, setBudget] = useState(() => {
    if (typeof window === "undefined") return 60;
    try {
      const stored = Number(localStorage.getItem(BUDGET_KEY));
      return stored >= 20 ? stored : 60;
    } catch {
      return 60;
    }
  });
  const [busyBlock, setBusyBlock] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function changeBudget(value: number) {
    setBudget(value);
    try {
      localStorage.setItem(BUDGET_KEY, String(value));
    } catch {
      /* preferência continua válida apenas nesta sessão */
    }
  }

  async function buildBlockAttempt(block: DailyPlanBlock): Promise<Attempt> {
    if (block.kind === "srs") return buildDueReviewsAttempt(db, block.questions, providerId);
    if (block.kind === "weak") return buildContentSprintAttempt(block.content!, block.questions);
    if (block.kind === "adaptive") return buildAdaptiveAttempt(db, block.questions);
    return buildTrainingAttempt(db, {
      year: 2023,
      lang: "ingles",
      mode: "unseen15",
      area: "all",
      minutes: Math.max(35, block.minutes),
      strict: false,
      strategy: false,
      alerts: true,
    });
  }

  async function startBlock(block: DailyPlanBlock) {
    setBusyBlock(block.id);
    setErr("");
    try {
      const attempt = await buildBlockAttempt(block);
      attempt.plan = {
        source: "daily-plan",
        dateKey: plan.dateKey,
        blockId: block.id,
      };
      addAttempt(attempt);
      router.push(`/exam/${attempt.id}`);
    } catch (error) {
      setErr((error as Error).message || "Não foi possível montar este bloco.");
      setBusyBlock(null);
    }
  }

  if (!hydrated) return <Card><span className="muted">Carregando plano…</span></Card>;

  const plan = buildDailyPlan(db, budget, now, providerId);
  const stats = areaStats(db, providerId);
  const activePlan = db.attempts.find(
    (attempt) => attempt.plan?.source === "daily-plan" && attempt.plan.dateKey === plan.dateKey && !attempt.finishedAt,
  );
  const progress = Math.min(100, Math.round((plan.signals.minutesToday / Math.max(1, plan.budgetMinutes)) * 100));

  // Prontidão é medida na taxonomia da prova ativa, não nas áreas do ENEM.
  const readiness = areasOf(providerId).map(({ id: area, label }) => {
    const value = stats[area] || { c: 0, t: 0 };
    const ci = wilsonInterval(value.c, value.t);
    return {
      area,
      label,
      ...value,
      low: ci.low,
      high: ci.high,
      p: value.t ? pct(value.c, value.t) : null,
    };
  });

  return (
    <div className="dailyPlanPage">
      <PageHead
        eyebrow="Plano · inteligência diária"
        title="Seu estudo de hoje, já priorizado."
        sub="O plano recalcula depois de cada bloco usando retenção, confiança estatística, ritmo semanal, tempo disponível e histórico real de resolução."
        right={
          <Link className="btn secondary link-btn" href="/adaptive">
            Abrir Adaptive
          </Link>
        }
      />

      {activePlan && (
        <div className="dailyPlanActive">
          <div>
            <strong>Sessão do plano em andamento</strong>
            <span>
              Você já iniciou um bloco hoje. Termine ou retome antes de abrir outro para manter o diagnóstico limpo.
            </span>
          </div>
          <Link className="btn link-btn" href={`/exam/${activePlan.id}`}>
            Continuar <ArrowRight size={15} />
          </Link>
        </div>
      )}

      <div className="dailyPlanOverview">
        <Card className="dailyPlanBudget">
          <div className="dailyPlanBudgetHead">
            <div>
              <div className="eyebrow">TEMPO DISPONÍVEL</div>
              <h2>Quanto cabe no seu dia?</h2>
            </div>
            <div className="dailyPlanBudgetValue">
              <b>{plan.budgetMinutes} min</b>
              <span>orçamento de hoje</span>
            </div>
          </div>

          <div className="dailyBudgetPresets" aria-label="Tempo disponível para estudar hoje">
            {BUDGET_PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                className={budget === value ? "active" : ""}
                onClick={() => changeBudget(value)}
                aria-pressed={budget === value}
              >
                {value} min
              </button>
            ))}
          </div>

          <div className="dailyPlanProgress">
            <div className="dailyPlanProgressLine">
              <span>tempo estudado hoje</span>
              <b>{plan.signals.minutesToday}/{plan.budgetMinutes} min</b>
            </div>
            <div className="dailyPlanProgressTrack" aria-label={`${progress}% do tempo diário usado`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="dailyPlanBudgetNote">
            Seu ritmo recente é de aproximadamente <b>{plan.avgQuestionMinutes} min por questão</b>. O motor usa esse valor para não sugerir mais trabalho do que cabe no tempo escolhido.
          </div>
        </Card>

        <Card className="dailyPlanSummary">
          <div>
            <div className="eyebrow">MISSÃO DO DIA</div>
            <h2>{plan.blocks.length ? `${plan.blocks.length} bloco${plan.blocks.length > 1 ? "s" : ""}` : "Tempo cumprido"}</h2>
          </div>
          <div className="dailyPlanSummaryHero">
            <b>{plan.totalQuestions}</b>
            <span>questões planejadas para o restante do dia</span>
          </div>
          <div className="dailyPlanSummaryMeta">
            <div>
              <small>tempo planejado</small>
              <b>{plan.totalMinutes} min</b>
            </div>
            <div>
              <small>já concluídos</small>
              <b>{plan.signals.completedPlanBlocks} bloco(s)</b>
            </div>
          </div>
        </Card>
      </div>

      <div className="dailySignalGrid" aria-label="Sinais usados pelo plano">
        <div className="dailySignal">
          <RotateCcw size={15} />
          <small>retenção</small>
          <b>{plan.signals.dueReviews}</b>
          <span>revisões vencidas agora</span>
        </div>
        <div className="dailySignal">
          <Target size={15} />
          <small>ritmo semanal</small>
          <b>{plan.signals.weeklyQuestions}/{plan.signals.weeklyTarget || "—"}</b>
          <span>{plan.signals.paceDeficit ? `${plan.signals.paceDeficit} abaixo do ritmo esperado` : "ritmo esperado em dia"}</span>
        </div>
        <div className="dailySignal">
          <Clock3 size={15} />
          <small>hoje</small>
          <b>{plan.signals.questionsToday}</b>
          <span>questões já concluídas · alvo {plan.targetToday}</span>
        </div>
        <div className="dailySignal">
          <Gauge size={15} />
          <small>erro crítico</small>
          <b>{plan.signals.highConfidenceErrors}</b>
          <span>erros recentes respondidos com certeza</span>
        </div>
      </div>

      <Card className="dailyPlanQueueCard">
        <div className="dailyPlanQueueHead">
          <div>
            <div className="eyebrow">ORDEM RECOMENDADA</div>
            <h2>Plano para o restante de hoje</h2>
          </div>
          <span>recalcula automaticamente após cada tentativa</span>
        </div>

        {err && <div className="notice" style={{ marginTop: 12 }}>{err}</div>}

        {plan.blocks.length ? (
          <div className="dailyPlanQueue">
            {plan.blocks.map((block, index) => (
              <div className="dailyPlanBlock" data-kind={block.kind} key={block.id}>
                <div className="dailyPlanOrder">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <div className="eyebrow">{block.eyebrow}</div>
                  <h3>{block.title}</h3>
                  <div className="dailyPlanReason">{block.reason}</div>
                  <div className="dailyPlanMeta">
                    <span>{block.questions} questões</span>
                    <span>~{block.minutes} min</span>
                    {block.metric && <span>{block.metric}</span>}
                  </div>
                </div>
                <div className="dailyPlanAction">
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busyBlock || !!activePlan}
                    onClick={() => startBlock(block)}
                  >
                    {busyBlock === block.id ? (
                      <><span className="loader" /> montando</>
                    ) : (
                      <>{block.kind === "srs" ? "Revisar" : "Iniciar bloco"} <ArrowRight size={14} /></>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="dailyPlanEmpty">
            <BrainCircuit size={24} />
            <b>Seu orçamento de estudo já foi cumprido.</b>
            <span>
              Se ainda estiver bem, aumente o tempo disponível acima. Caso contrário, encerre por hoje: o plano foi feito para controlar carga, não apenas empilhar questões.
            </span>
          </div>
        )}
      </Card>

      <Card>
        <div className="dailyPlanQueueHead">
          <div>
            <div className="eyebrow">CONFIANÇA ESTATÍSTICA</div>
            <h2>Prontidão por área</h2>
          </div>
          <span>IC de Wilson 95% · sem TRI fictícia</span>
        </div>
        <div className="dailyReadinessGrid">
          {readiness.map((item) => (
            <div className="dailyReadinessItem" key={item.area}>
              <div className="row between">
                <b>{item.label}</b>
                <span className="muted">{item.p === null ? "sem amostra" : `${item.p}% · n=${item.t}`}</span>
              </div>
              <div className="ciBar" style={{ marginTop: 9 }}>
                {item.t > 0 && (
                  <span
                    className="range"
                    style={{ left: `${item.low}%`, width: `${Math.max(2, item.high - item.low)}%` }}
                  />
                )}
              </div>
              <div className="muted" style={{ marginTop: 7 }}>
                {item.t ? `faixa sustentável estimada: ${item.low}–${item.high}%` : "resolva questões desta área para calibrar"}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ height: 20 }} />
      <div className="muted" style={{ fontSize: 10, display: "flex", gap: 7, alignItems: "center" }}>
        <Sparkles size={12} /> O plano usa somente seu histórico local e se adapta conforme você conclui novas questões.
      </div>
    </div>
  );
}
