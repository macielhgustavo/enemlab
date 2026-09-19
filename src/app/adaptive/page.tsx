"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { shortSec } from "@/lib/format";
import { officialRowsOf } from "@/lib/domain/stats";
import { adaptiveCandidates } from "@/lib/domain/adaptive";
import { dueSRS } from "@/lib/domain/srs";
import { actionableWeakContents } from "@/lib/domain/weak-evidence";
import { ADAPTIVE_OBJECTIVES, type AdaptiveObjective } from "@/lib/domain/adaptive-objectives";
import {
  contentEvidence,
  counterfactualForContent,
  coverageSnapshot,
  falseErrorSignals,
  falseMasterySignals,
  knowledgeExecutionSplit,
  readinessSnapshot,
  temporalProfile,
} from "@/lib/domain/study-intelligence";
import {
  decisionHistory,
  experimentSummary,
  providerStudyConfig,
  setProviderStudyConfig,
} from "@/lib/domain/study-learning";
import {
  finalizePendingStudyIntelligence,
  recordFeedbackForDecision,
} from "@/lib/domain/study-learning-finalize";
import { studyGoalProgress } from "@/lib/domain/study-goal";
import type { StudyFeedbackValue } from "@/lib/domain/types";
import { buildNextStudyAttempt, nextStudyAction } from "@/lib/services/provider-study";
import { studyPlan } from "@/lib/services/study-plan";
import {
  buildIntelligentStudyLaunch,
  loadIntelligencePreview,
  persistIntelligentStudyLaunch,
  type IntelligencePreview,
  type IntelligentStudyKind,
} from "@/lib/services/intelligent-study";
import { useActiveProvider } from "@/components/ExamSwitch";
import { examLabel } from "@/lib/providers/label";
import { Metric, Empty, Card } from "@/components/ui";
import { ChevronDown } from "lucide-react";
import { NumberField } from "@/components/ui/number-field";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Choicebox,
  ChoiceboxItem,
  ChoiceboxItemHeader,
  ChoiceboxItemTitle,
  ChoiceboxItemDescription,
  ChoiceboxIndicator,
} from "@/components/ui/choicebox";
import {
  Timeline,
  TimelineItem,
  TimelineIndicator,
  TimelineSeparator,
  TimelineHeader,
  TimelineTitle,
  TimelineContent,
} from "@/components/ui/timeline";

const OBJECTIVE_COPY: Record<AdaptiveObjective, string> = {
  balanced: "Distribui a sessão entre revisões e novas questões.",
  recovery: "Retoma revisões atrasadas e conteúdos com mais dificuldade.",
  coverage: "Explora conteúdos que você ainda praticou pouco.",
  exam: "Treina a execução com conteúdos já conhecidos.",
  gain: "Prioriza onde há mais espaço para melhorar.",
};

const ACTION_LABEL: Record<string, string> = {
  review: "Fazer revisões agora",
  weakness: "Reparar conteúdo fraco",
  retry: "Refazer erros prioritários",
  unseen: "Começar amostra inédita",
  adaptive: "Avançar com Adaptive 15",
};

const RETRY_COMPONENT_LABELS: Record<string, string> = {
  contentGap: "lacuna",
  confidence: "confiança",
  slow: "tempo",
  diagnosedReason: "diagnóstico",
};

interface ObjectiveDraft {
  providerId: string;
  value: AdaptiveObjective;
}

interface GoalDraft {
  providerId: string;
  date: string;
  weekly: string;
  readiness: string;
  coverage: string;
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function AdaptivePage() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const router = useRouter();
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  const config = providerStudyConfig(db, providerId);
  const [objectiveDraft, setObjectiveDraft] = useState<ObjectiveDraft | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [preview, setPreview] = useState<IntelligencePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const objective =
    objectiveDraft?.providerId === providerId
      ? objectiveDraft.value
      : (config.objective ?? "balanced");
  const currentGoalDraft: GoalDraft =
    goalDraft?.providerId === providerId
      ? goalDraft
      : {
          providerId,
          date: config.targetDate ?? "",
          weekly: config.weeklyQuestions?.toString() ?? "",
          readiness: config.targetReadiness?.toString() ?? "",
          coverage: config.targetCoverage?.toString() ?? "",
        };

  function finishPending() {
    mutate((current) => {
      finalizePendingStudyIntelligence(current, providerId);
    });
  }

  async function continueCycle() {
    setBusy(true);
    setErr("");
    try {
      finishPending();
      const current = useStore.getState().db;
      const attempt = await buildNextStudyAttempt(current, providerId, 15);
      useStore.getState().addAttempt(attempt);
      router.push(`/exam/${attempt.id}`);
    } catch (error) {
      setErr((error as Error).message || "Não foi possível montar a próxima etapa.");
      setBusy(false);
    }
  }

  async function launch(kind: IntelligentStudyKind, n: number) {
    setBusy(true);
    setErr("");
    try {
      finishPending();
      const current = useStore.getState().db;
      const launchResult = await buildIntelligentStudyLaunch(current, providerId, {
        kind,
        objective,
        n,
      });
      mutate((next) => persistIntelligentStudyLaunch(next, launchResult));
      router.push(`/exam/${launchResult.attempt.id}`);
    } catch (error) {
      setErr((error as Error).message || "Não foi possível montar este treino.");
      setBusy(false);
    }
  }

  async function inspectQueue() {
    setBusy(true);
    setErr("");
    try {
      finishPending();
      const current = useStore.getState().db;
      setPreview(await loadIntelligencePreview(current, providerId, objective));
    } catch (error) {
      setErr(
        (error as Error).message || "Não foi possível carregar a inteligência desta prova.",
      );
    } finally {
      setBusy(false);
    }
  }

  function changeObjective(next: AdaptiveObjective) {
    setObjectiveDraft({ providerId, value: next });
    setPreview(null);
    mutate((current) => {
      setProviderStudyConfig(current, providerId, { objective: next });
    });
  }

  function updateGoal(patch: Partial<Omit<GoalDraft, "providerId">>) {
    setGoalDraft({ ...currentGoalDraft, ...patch, providerId });
  }

  function saveGoal() {
    mutate((current) => {
      setProviderStudyConfig(current, providerId, {
        objective,
        targetDate: currentGoalDraft.date || null,
        weeklyQuestions: optionalNumber(currentGoalDraft.weekly),
        targetReadiness: optionalNumber(currentGoalDraft.readiness),
        targetCoverage: optionalNumber(currentGoalDraft.coverage),
      });
    });
  }

  function rateDecision(decisionId: string, value: StudyFeedbackValue) {
    mutate((current) => {
      recordFeedbackForDecision(current, decisionId, value, new Date().toISOString());
    });
  }

  if (!hydrated) {
    return (
      <Card>
        <span className="muted">Carregando…</span>
      </Card>
    );
  }

  const cand = adaptiveCandidates(db, providerId);
  const weak = actionableWeakContents(db, 4, providerId);
  const due = dueSRS(db, providerId);
  const recommendation = nextStudyAction(db, providerId);
  const plan = studyPlan(db, providerId);
  const topRetry = cand[0];
  const certezaWrong = officialRowsOf(db, providerId).filter(
    (row) => row.isCorrect === false && row.confidence === "certeza",
  ).length;

  const expectedContents = preview?.expectedContents;
  const readiness = preview?.readiness ?? readinessSnapshot(db, providerId, expectedContents);
  const coverage = preview?.coverage ?? coverageSnapshot(db, providerId, expectedContents);
  const split = knowledgeExecutionSplit(db, providerId);
  const falseMastery = falseMasterySignals(db, providerId);
  const falseErrors = falseErrorSignals(db, providerId).filter(
    (item) => item.likelyExecutionNoise,
  );
  const temporal = temporalProfile(db, providerId);
  const evidence = contentEvidence(db, providerId);
  const counterfactualTarget = weak[0]
    ? (evidence.find((item) => item.content === weak[0].name) ?? null)
    : (evidence[0] ?? null);
  const counterfactual = counterfactualForContent(counterfactualTarget);
  const history = decisionHistory(db, providerId, 6);
  const experiment = experimentSummary(db, "adaptive-feedback-v1");
  const currentConfig = providerStudyConfig(db, providerId);
  const goal =
    preview?.goal ?? studyGoalProgress(db, { providerId, ...currentConfig }, expectedContents);

  return (
    <div className="adaptive-page">
      <section className="adaptive-intro" aria-labelledby="adaptive-title">
        <span className="adaptive-kicker">{examLabel(providerId)} / Estudo adaptativo</span>
        <h1 id="adaptive-title">Adaptive</h1>
        <p className="adaptive-intro__lead">
          Escolha o foco do treino. A próxima sessão parte do seu histórico.
        </p>

        <div className="adaptive-recommendation">
          <div className="prio">Próxima sessão</div>
          <h2>{recommendation.title}</h2>
          <p>{recommendation.reason}</p>
        </div>

        <div className="adaptive-objective">
          <span className="adaptive-objective__label">Foco do treino</span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="objective-trigger"
                type="button"
                aria-label="Escolher objetivo"
              >
                {ADAPTIVE_OBJECTIVES[objective].label}
                <ChevronDown size={15} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="objective-popover" align="end" aria-label="Escolher objetivo do treino">
              <Choicebox
                value={objective}
                onValueChange={(value) => changeObjective(value as AdaptiveObjective)}
                aria-label="Objetivo do treino"
              >
                {Object.values(ADAPTIVE_OBJECTIVES).map((profile) => (
                  <ChoiceboxItem value={profile.id} key={profile.id}>
                    <ChoiceboxItemHeader>
                      <ChoiceboxItemTitle>{profile.label}</ChoiceboxItemTitle>
                      <ChoiceboxItemDescription>{OBJECTIVE_COPY[profile.id]}</ChoiceboxItemDescription>
                    </ChoiceboxItemHeader>
                    <ChoiceboxIndicator />
                  </ChoiceboxItem>
                ))}
              </Choicebox>
            </PopoverContent>
          </Popover>
          <div className="muted adaptive-objective__detail">
            {OBJECTIVE_COPY[objective]}
          </div>
        </div>

        <div className="adaptive-actions">
          <button className="btn" onClick={() => launch("objective", 15)} disabled={busy}>
            Treinar objetivo · 15
          </button>
          <div className="adaptive-actions__alternatives" aria-label="Outras formas de estudar">
            <button className="btn secondary" onClick={continueCycle} disabled={busy}>
              {ACTION_LABEL[recommendation.kind] ?? "Continuar ciclo"}
            </button>
            <button
              className="btn secondary"
              onClick={() => launch("queue", 15)}
              disabled={busy}
            >
              Fila global · 15
            </button>
            <button
              className="btn secondary"
              onClick={() => launch("diagnostic", 25)}
              disabled={busy}
            >
              Diagnóstico · 25
            </button>
            <button className="btn secondary" onClick={inspectQueue} disabled={busy}>
              Inspecionar próximas 40
            </button>
          </div>
        </div>

        {(busy || err) && (
          <div className="notice" style={{ marginTop: 12 }}>
            {busy && (
              <span className="loader" style={{ display: "inline-block", marginRight: 8 }} />
            )}
            {busy ? "Calculando com o banco real desta prova…" : err}
          </div>
        )}
      </section>

      <section className="grid grid4 adaptive-kpis" aria-label="Indicadores de estudo">
        <Metric label="Studium Readiness" value={`${readiness.score}/100`} />
        <Metric label="Conhecimento" value={`${split.knowledgeScore}%`} />
        <Metric label="Execução" value={`${split.executionScore}/100`} />
        <Metric
          label="Cobertura calibrada"
          value={coverage.calibratedPct === null ? "—" : `${coverage.calibratedPct}%`}
        />
      </section>
      <div className="muted adaptive-kpis__note">
        confiança do readiness: {readiness.confidence} · amostra n={readiness.sample} ·{" "}
        {readiness.note}
        {coverage.expected === null
          ? " · cobertura sem denominador até carregar o banco da prova"
          : ` · ${coverage.calibrated}/${coverage.expected} conteúdos calibrados no banco carregado`}
      </div>

      <Tabs defaultValue="study" className="adaptive-workspace">
        <TabsList variant="line" aria-label="Áreas do Adaptive">
          <TabsTrigger value="study">Sessão e fila</TabsTrigger>
          <TabsTrigger value="diagnosis">Diagnóstico</TabsTrigger>
          <TabsTrigger value="goals">Metas</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="study">
          <section className="adaptive-plan" aria-labelledby="study-plan-title">
            <h2 id="study-plan-title">Seu ciclo de estudo</h2>
            <Timeline value={plan.filter((step) => step.done).length} orientation="horizontal">
              {plan.map((step, index) => (
                <TimelineItem
                  step={index + 1}
                  key={step.title}
                  aria-current={step.active ? "step" : undefined}
                >
                  <TimelineSeparator />
                  <TimelineIndicator />
                  <TimelineHeader>
                    <span className="adaptive-step-status">
                      {step.active ? "Agora" : step.done ? "Em dia" : "Depois"}
                    </span>
                    <TimelineTitle>{step.title.replace(/^\d+\.\s*/, "")}</TimelineTitle>
                  </TimelineHeader>
                  <TimelineContent>{step.detail}</TimelineContent>
                </TimelineItem>
              ))}
            </Timeline>
          </section>
          <section className="grid grid4 adaptive-signals" aria-label="Sinais da fila">
            <Metric label="Revisões vencidas" value={due.length} />
            <Metric label="Erros com certeza" value={certezaWrong} />
            <Metric label="Conteúdos fracos" value={weak.length} />
            <Metric label="Fila de erros" value={cand.length} />
          </section>

          {preview && (
            <Card style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                <div>
                  <h2>Próximas 40 · fila única</h2>
                  <div className="muted">
                    Banco: {preview.poolSize} questões · {preview.expectedContents.length}{" "}
                    conteúdos detectados · diagnóstico selecionaria{" "}
                    {preview.diagnostic.selected.length}.
                  </div>
                </div>
                <span className="pill">{ADAPTIVE_OBJECTIVES[preview.objective].label}</span>
              </div>
              <div className="queue" style={{ marginTop: 10 }}>
                {preview.queue.slice(0, 12).map((item, index) => (
                  <div className="queueItem" key={item.questionKey}>
                    <div className="qnum">{index + 1}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                        <b>{item.content}</b>
                        <span className="pill">
                          {item.kind} · evidência {item.confidence}
                        </span>
                      </div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                        {item.reasons[0] ?? "Priorizada pelo motor."}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="grid grid2" style={{ marginTop: 14 }}>
            <Card>
              <h2>Fila de erros</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                O score não é nota: ordena qual erro vale recuperar primeiro.
              </p>
              <div className="queue" style={{ marginTop: 10 }}>
                {cand.length === 0 && <Empty>Sem erros para priorizar.</Empty>}
                {cand.slice(0, 8).map((item) => (
                  <div className="queueItem" key={`${item.attemptId}-${item.key}`}>
                    <div className="qnum">{item.index}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                        <b>{item.content}</b>
                        <span className="pill">score {Math.round(item.score)}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {examLabel(providerId)} {item.year} •{" "}
                        {item.confidence || "sem confiança"} • {shortSec(item.timeSec)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2>O que mudaria a prioridade?</h2>
              <div className="studyBlock">
                <div className="prio">
                  contrafactual · {counterfactualTarget?.content ?? "sem conteúdo calibrado"}
                </div>
                <h3>Não basta explicar o score.</h3>
                <div className="muted">{counterfactual.join(" ")}</div>
              </div>
              {topRetry && (
                <div className="studyBlock" style={{ marginTop: 8 }}>
                  <div className="prio">topo da fila de erros</div>
                  <h3>
                    {topRetry.content} · {Math.round(topRetry.score)} pontos
                  </h3>
                  <div className="muted">
                    {Object.entries(topRetry.components)
                      .filter(([, value]) => value !== 0)
                      .map(
                        ([key, value]) =>
                          `${RETRY_COMPONENT_LABELS[key] ?? key} ${value > 0 ? "+" : ""}${Math.round(value)}`,
                      )
                      .join(" · ")}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="diagnosis">
          <div className="grid grid2" style={{ marginTop: 14 }}>
            <Card>
              <h2>Riscos que a média esconde</h2>
              {falseMastery.length === 0 && falseErrors.length === 0 ? (
                <Empty>
                  Nenhum sinal forte de falso domínio ou falso erro com a evidência atual.
                </Empty>
              ) : (
                <div className="queue" style={{ marginTop: 10 }}>
                  {falseMastery.slice(0, 4).map((item) => (
                    <div className="studyBlock" key={`mastery-${item.content}`}>
                      <div className="prio">falso domínio · risco {item.risk}/100</div>
                      <h3>{item.content}</h3>
                      <div className="muted">{item.reasons.join(" ")}</div>
                    </div>
                  ))}
                  {falseErrors.slice(0, 4).map((item) => (
                    <div className="studyBlock" key={`error-${item.attemptId}-${item.key}`}>
                      <div className="prio">possível falso erro</div>
                      <h3>{item.content}</h3>
                      <div className="muted">{item.reasons.join(" ")}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h2>Execução e tempo</h2>
              <div className="studyBlock">
                <div className="prio">diagnóstico · {split.diagnosis}</div>
                <h3>
                  {split.knowledgeScore}% conhecimento · {split.actualAccuracy}% resultado real
                </h3>
                <div className="muted">
                  {split.executionErrors} erro(s) de execução diagnosticados · {split.slowRows}{" "}
                  questão(ões) acima de 4 min.
                </div>
              </div>
              <div className="studyBlock" style={{ marginTop: 8 }}>
                <div className="prio">perfil temporal</div>
                <h3>
                  {temporal.bestBucket
                    ? `Melhor janela: ${temporal.bestBucket.label}`
                    : "Horário ainda calibrando"}
                </h3>
                <div className="muted">
                  {temporal.fatiguedAttempts >= 2 && temporal.fatigueThresholdMinutes
                    ? `Queda repetida após ~${temporal.fatigueThresholdMinutes} min; novos blocos podem ser encurtados, nunca ampliados.`
                    : "O motor só encurta blocos depois de pelo menos duas evidências de fadiga."}
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="goals">
          <Card className="adaptive-goal">
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}
            >
              <div>
                <h2>Meta da prova</h2>
                <p className="muted" style={{ marginTop: 4 }}>
                  Ritmo, cobertura e readiness são metas operacionais. Nenhuma delas é previsão
                  de aprovação.
                </p>
              </div>
              <span className="pill">{goal.status}</span>
            </div>
            <div className="grid grid4" style={{ marginTop: 12 }}>
              <div>
                <label htmlFor="goal-date">Data-alvo</label>
                <input
                  id="goal-date"
                  type="date"
                  value={currentGoalDraft.date}
                  onChange={(e) => updateGoal({ date: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="goal-weekly">Questões/semana</label>
                <NumberField
                  id="goal-weekly"
                  label="Questões/semana"
                  min="0"
                  value={currentGoalDraft.weekly}
                  onValueChange={(weekly) => updateGoal({ weekly })}
                />
              </div>
              <div>
                <label htmlFor="goal-readiness">Readiness alvo</label>
                <NumberField
                  id="goal-readiness"
                  label="Readiness alvo"
                  min="0"
                  max="100"
                  value={currentGoalDraft.readiness}
                  onValueChange={(readiness) => updateGoal({ readiness })}
                />
              </div>
              <div>
                <label htmlFor="goal-coverage">Cobertura alvo %</label>
                <NumberField
                  id="goal-coverage"
                  label="Cobertura alvo %"
                  min="0"
                  max="100"
                  value={currentGoalDraft.coverage}
                  onValueChange={(coverage) => updateGoal({ coverage })}
                />
              </div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button type="button" className="btn secondary" onClick={saveGoal}>
                Salvar meta
              </button>
              <span className="muted">
                {goal.weeklyQuestionsDone}/{goal.weeklyQuestionsTarget || "—"} questões nos
                últimos 7 dias
                {goal.daysRemaining === null ? "" : ` · ${goal.daysRemaining} dia(s) restantes`}
              </span>
            </div>
            {goal.reasons.length > 0 && (
              <div className="notice" style={{ marginTop: 10 }}>
                {goal.reasons.slice(0, 3).join(" ")}
              </div>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="history">
          <div className="grid grid2" style={{ marginTop: 14 }}>
            <Card>
              <h2>Histórico das decisões</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                Feedback só personaliza um sinal depois de 3 avaliações compatíveis e o peso
                fica limitado a ±10%.
              </p>
              <div className="queue" style={{ marginTop: 10 }}>
                {history.length === 0 && <Empty>Nenhuma decisão nova registrada ainda.</Empty>}
                {history.map((item) => (
                  <div className="studyBlock" key={item.id}>
                    <div className="prio">
                      {ADAPTIVE_OBJECTIVES[item.objective].label} ·{" "}
                      {new Date(item.at).toLocaleDateString("pt-BR")}
                    </div>
                    <h3>{item.topContent || `${item.questionKeys.length} questões`}</h3>
                    <div className="muted">
                      antes {item.readinessBefore ?? "—"} · depois{" "}
                      {item.readinessAfter ?? "pendente"} · acerto{" "}
                      {item.accuracyAfter === null || item.accuracyAfter === undefined
                        ? "—"
                        : `${item.accuracyAfter}%`}
                    </div>
                    <div className="row" style={{ marginTop: 7 }}>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => rateDecision(item.id, "helpful")}
                      >
                        Útil
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => rateDecision(item.id, "neutral")}
                      >
                        Neutro
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => rateDecision(item.id, "not_helpful")}
                      >
                        Não ajudou
                      </button>
                      {item.feedback && (
                        <span className="muted">registrado: {item.feedback.usefulness}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2>Experimento interno</h2>
              <div className="studyBlock">
                <div className="prio">adaptive-feedback-v1 · {experiment.status}</div>
                <h3>Base × pesos aprendidos por feedback</h3>
                <div className="muted">{experiment.note}</div>
              </div>
              <div className="grid grid2" style={{ marginTop: 8 }}>
                {experiment.variants.map((variant) => (
                  <div className="studyBlock" key={variant.variant}>
                    <div className="prio">{variant.variant}</div>
                    <h3>n={variant.n}</h3>
                    <div className="muted">
                      Δ readiness {variant.avgReadinessDelta ?? "—"} · acerto{" "}
                      {variant.avgAccuracy === null ? "—" : `${variant.avgAccuracy}%`} · útil{" "}
                      {variant.helpfulRate === null ? "—" : `${variant.helpfulRate}%`}
                    </div>
                  </div>
                ))}
              </div>
              {experiment.variants.length === 0 && (
                <Empty>O experimento começa nos próximos treinos inteligentes.</Empty>
              )}
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
