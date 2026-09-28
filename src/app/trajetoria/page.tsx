"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Gauge,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { LoadingState } from "@/components/enem-lab/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setProviderStudyConfig, providerStudyConfig } from "@/lib/domain/study-learning";
import { buildWeeklyTrajectory, type TrajectoryRhythm } from "@/lib/domain/weekly-trajectory";
import { useHydrated } from "@/lib/hooks";
import { getProvider, resolveProviderId } from "@/lib/providers";
import { examLabel } from "@/lib/providers/label";
import { useStore } from "@/lib/store";

function rhythmLabel(value: TrajectoryRhythm): string {
  if (value === "ahead") return "adiantado";
  if (value === "on-track") return "dentro do plano";
  if (value === "behind") return "abaixo do ritmo";
  return "calibração";
}

function rhythmVariant(value: TrajectoryRhythm): "success" | "warning" | "danger" | "info" {
  if (value === "ahead") return "success";
  if (value === "on-track") return "info";
  if (value === "behind") return "danger";
  return "warning";
}

export default function TrajectoryPage() {
  const hydrated = useHydrated();
  const db = useStore((state) => state.db);
  const mutate = useStore((state) => state.mutate);
  const [goalDraft, setGoalDraft] = useState<{
    providerId: string;
    targetDate: string;
    questions: string;
    reviews: string;
    essays: string;
  } | null>(null);

  if (!hydrated) {
    return (
      <Card>
        <LoadingState lines={6} label="Calculando trajetória" />
      </Card>
    );
  }

  const providerId = resolveProviderId(db.activeProvider);
  const provider = getProvider(providerId);
  const config = providerStudyConfig(db, providerId);
  const draft =
    goalDraft?.providerId === providerId
      ? goalDraft
      : {
          providerId,
          targetDate: config.targetDate ?? "",
          questions: String(config.weeklyQuestions ?? db.goals.questions ?? 0),
          reviews: String(db.goals.reviews ?? 0),
          essays: String(db.goals.essays ?? 0),
        };
  const trajectory = buildWeeklyTrajectory(db, providerId);

  function patchGoal(patch: Partial<typeof draft>) {
    setGoalDraft({ ...draft, ...patch, providerId });
  }

  function saveGoals() {
    mutate((current) => {
      setProviderStudyConfig(current, providerId, {
        targetDate: draft.targetDate.trim() || null,
        weeklyQuestions: Math.max(0, Number(draft.questions) || 0),
      });
      current.goals.reviews = Math.max(0, Number(draft.reviews) || 0);
      current.goals.essays = Math.max(0, Number(draft.essays) || 0);
    });
    setGoalDraft(null);
  }

  const rhythmIcon =
    trajectory.rhythm === "ahead" ? (
      <TrendingUp aria-hidden="true" />
    ) : trajectory.rhythm === "behind" ? (
      <TrendingDown aria-hidden="true" />
    ) : (
      <Gauge aria-hidden="true" />
    );

  return (
    <div className="el-trajectory">
      <PageHeader
        eyebrow="Planejamento · médio prazo"
        title="Trajetória até a prova"
        description="Compare o que foi realizado com o esperado nesta semana. O sinal de ritmo usa apenas seu histórico e suas metas — não prevê aprovação nem nota de prova."
        context={
          <>
            <Badge variant="accent">{examLabel(providerId)}</Badge>
            <Badge variant={rhythmVariant(trajectory.rhythm)}>
              {rhythmLabel(trajectory.rhythm)}
            </Badge>
          </>
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/plano">Abrir plano de hoje</Link>
          </Button>
        }
      />

      <div className="el-trajectory__top">
        <Card variant="raised" className="el-trajectory__rhythm">
          <div className="el-trajectory__icon">{rhythmIcon}</div>
          <div>
            <span className="eyebrow">RITMO RECENTE</span>
            <h2>{rhythmLabel(trajectory.rhythm)}</h2>
            <p className="muted">
              {trajectory.rhythmPct === null
                ? "Defina metas semanais para comparar o ritmo."
                : trajectory.rhythmPct + "% do esperado até hoje, considerando as metas aplicáveis."}
            </p>
          </div>
          <div className="el-trajectory__confidence">
            <span>confiança</span>
            <strong>{trajectory.confidence}</strong>
          </div>
        </Card>

        <Card className="el-trajectory__deadline">
          <div className="el-trajectory__section-head">
            <CalendarDays size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">DATA-ALVO</span>
              <h2>
                {trajectory.targetDate
                  ? new Date(trajectory.targetDate + "T12:00:00").toLocaleDateString("pt-BR")
                  : "Não definida"}
              </h2>
            </div>
          </div>
          {trajectory.daysRemaining === null ? (
            <p className="muted">Defina uma data para ver dias e semanas restantes.</p>
          ) : trajectory.daysRemaining < 0 ? (
            <p className="muted">A data configurada já passou. Atualize-a abaixo.</p>
          ) : (
            <div className="el-trajectory__remaining">
              <strong>{trajectory.daysRemaining}</strong>
              <span>dias</span>
              <i />
              <strong>{trajectory.weeksRemaining}</strong>
              <span>semanas</span>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="el-trajectory__section-head">
          <Target size={18} aria-hidden="true" />
          <div>
            <span className="eyebrow">ESTA SEMANA</span>
            <h2>Realizado × esperado até hoje</h2>
            <p className="muted">
              Semana de {trajectory.weekStart.split("-").reverse().join("/")} a{" "}
              {trajectory.weekEnd.split("-").reverse().join("/")} · dia{" "}
              {trajectory.elapsedWeekDays} de 7
            </p>
          </div>
        </div>

        <div className="el-trajectory__metrics">
          {trajectory.metrics.map((item) => (
            <article key={item.key}>
              <div>
                <span>{item.label}</span>
                <strong>
                  {item.done}
                  <small> / {item.target || "—"}</small>
                </strong>
              </div>
              <div className="el-trajectory__metric-bar" aria-hidden="true">
                <span style={{ width: Math.min(100, item.pacePct ?? 0) + "%" }} />
              </div>
              <small>
                {item.target
                  ? item.expectedByNow + " esperado(s) até hoje · " + (item.pacePct ?? 0) + "% desse ritmo"
                  : "meta não definida"}
              </small>
            </article>
          ))}
        </div>

        <div className="el-trajectory__reasons">
          {trajectory.reasons.slice(0, 4).map((reason) => (
            <span key={reason}>
              <CheckCircle2 size={14} aria-hidden="true" />
              {reason}
            </span>
          ))}
        </div>
      </Card>

      <Card>
        <div className="el-trajectory__section-head">
          <Gauge size={18} aria-hidden="true" />
          <div>
            <span className="eyebrow">DOMÍNIO POR ÁREA</span>
            <h2>Últimas seis semanas</h2>
            <p className="muted">
              Cada coluna usa apenas respostas daquela semana. Pouca amostra é mostrada como incerteza, não como domínio.
            </p>
          </div>
        </div>

        <div className="el-trajectory__areas">
          {trajectory.areas.map((area) => (
            <article key={area.id}>
              <div className="el-trajectory__area-head">
                <div>
                  <strong>{area.label}</strong>
                  <span className="caption muted">
                    {area.total
                      ? area.total + " respostas · confiança " + area.confidence
                      : "sem amostra"}
                  </span>
                </div>
                <b>{area.accuracy === null ? "—" : area.accuracy + "%"}</b>
              </div>
              <div className="el-trajectory__weeks">
                {area.history.map((point) => (
                  <div key={point.weekStart}>
                    <div className="el-trajectory__week-bar">
                      <span
                        style={{ height: (point.accuracy ?? 0) + "%" }}
                        className={point.total < 4 ? "is-low-sample" : ""}
                      />
                    </div>
                    <small>{point.label}</small>
                    <em>{point.total ? point.total + "q" : "—"}</em>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Card>

      <div className="el-trajectory__bottom">
        <Card className="el-trajectory__next">
          <span className="eyebrow">PRÓXIMA SEMANA</span>
          <h2>Resumo de carga</h2>
          <div className="el-trajectory__next-grid">
            <span>
              <b>{trajectory.nextWeek.questions}</b>
              questões
            </span>
            <span>
              <b>{trajectory.nextWeek.reviews}</b>
              revisões
            </span>
            {provider.metadata.hasEssay ? (
              <span>
                <b>{trajectory.nextWeek.essays}</b>
                redações
              </span>
            ) : null}
          </div>
          <p className="muted">{trajectory.nextWeek.note}</p>
          {trajectory.nextWeek.focusArea ? (
            <Badge variant="outline">foco sugerido: {trajectory.nextWeek.focusArea}</Badge>
          ) : null}
        </Card>

        <Card className="el-trajectory__config">
          <span className="eyebrow">AJUSTAR TRAJETÓRIA</span>
          <h2>Metas usadas pelo Plano</h2>
          <div className="el-trajectory__config-grid">
            <label>
              <span>Data-alvo</span>
              <input
                type="date"
                value={draft.targetDate}
                onChange={(event) => patchGoal({ targetDate: event.target.value })}
              />
            </label>
            <label>
              <span>Questões / semana</span>
              <input
                type="number"
                min={0}
                value={draft.questions}
                onChange={(event) => patchGoal({ questions: event.target.value })}
              />
            </label>
            <label>
              <span>Revisões / semana</span>
              <input
                type="number"
                min={0}
                value={draft.reviews}
                onChange={(event) => patchGoal({ reviews: event.target.value })}
              />
            </label>
            {provider.metadata.hasEssay ? (
              <label>
                <span>Redações / semana</span>
                <input
                  type="number"
                  min={0}
                  value={draft.essays}
                  onChange={(event) => patchGoal({ essays: event.target.value })}
                />
              </label>
            ) : null}
          </div>
          <p className="caption muted">
            Questões e data ficam na configuração desta prova. Revisões e redações usam as metas globais já existentes. Alterar metas não apaga histórico.
          </p>
          <Button variant="primary" onClick={saveGoals}>
            Salvar metas
          </Button>
        </Card>
      </div>

      <div className="el-trajectory__footer">
        <span>
          O índice de prontidão interno não é nota prevista e o ritmo não é probabilidade de aprovação.
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/adaptive">
            Ver motor adaptativo <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
