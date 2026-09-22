"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock3,
  Crosshair,
  FileText,
  Repeat2,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { Sk } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import {
  dashboardGreeting,
  dashboardRelativeTime,
  dashboardSparklinePoints,
  type DashboardModel,
} from "@/lib/domain/dashboard";
import { pct, shortSec } from "@/lib/format";
import { examLabel } from "@/lib/providers/label";

const EvolutionArea = dynamic(
  () => import("@/components/charts").then((module) => module.EvolutionArea),
  {
    ssr: false,
    loading: () => <Sk h={220} r={12} />,
  },
);

function Sparkline({ values }: { values: number[] }) {
  const points = dashboardSparklinePoints(values);
  if (!points) return <span className="dash-spark dash-spark--empty" />;
  return (
    <svg
      className="dash-spark"
      viewBox="0 0 96 32"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function Panel({
  children,
  className = "",
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section className={`dash-panel ${className}`} aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}

function PanelHeading({
  id,
  eyebrow,
  title,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="dash-panel__heading">
      <div>
        <p>{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      {action ? <div className="dash-panel__action">{action}</div> : null}
    </header>
  );
}

function Metric({
  label,
  value,
  supporting,
  icon,
  spark,
}: {
  label: string;
  value: ReactNode;
  supporting: string;
  icon: ReactNode;
  spark?: number[];
}) {
  return (
    <article className="dash-metric">
      <div className="dash-metric__top">
        <span className="dash-metric__icon">{icon}</span>
        {spark ? <Sparkline values={spark} /> : null}
      </div>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{supporting}</small>
    </article>
  );
}

export function Dashboard({
  model,
  providerId,
  now,
}: {
  model: DashboardModel;
  providerId: string;
  now: Date;
}) {
  const {
    recentAccuracy,
    recentResponseCount,
    dueItems,
    streak,
    weak,
    evolution,
    completedCount,
    questionsToday,
    dailyProgress,
    activeDays,
    sessionsPerWeek,
    totalQuestions,
    totalTime,
    delta,
    confidence,
    areas,
    consolidatedAreas,
    mission,
    recentAttempts,
    providerSummaries,
    introMessage,
  } = model;

  return (
    <div className="performance-dashboard">
      <header className="dashboard-intro">
        <div>
          <p className="dashboard-intro__eyebrow">
            Centro de controle ·{" "}
            {now.toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <h1>{dashboardGreeting(now.getHours())}.</h1>
          <p>{introMessage}</p>
        </div>
        <div className="dashboard-intro__meta" aria-label="Resumo da prova ativa">
          <span>
            prova ativa<strong>{examLabel(providerId)}</strong>
          </span>
          <span>
            confiança<strong>{confidence.label}</strong>
          </span>
        </div>
      </header>

      <div className="dashboard-grid">
        <Panel className="dash-mission" labelledBy="mission-title">
          <div className="dash-grid-fade" aria-hidden="true" />
          <div className="dash-mission__content">
            <p>{mission.eyebrow}</p>
            <h2 id="mission-title">{mission.title}</h2>
            <span>{mission.description}</span>
            <Button asChild variant="primary" className="dash-mission__button">
              <Link href={mission.href}>
                {mission.cta} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <div className="dash-mission__signal" aria-hidden="true">
            <Crosshair />
            <span>FOCO</span>
          </div>
        </Panel>

        <Panel className="dash-readiness" labelledBy="readiness-title">
          <PanelHeading id="readiness-title" eyebrow="sinal recente" title="Prontidão" />
          <div className="dash-readiness__body">
            <div
              className="dash-radial"
              style={{ "--score": recentAccuracy ?? 0 } as CSSProperties}
            >
              <div>
                <strong>{recentAccuracy === null ? "—" : recentAccuracy}</strong>
                {recentAccuracy !== null ? <span>%</span> : null}
                <small>últimas respostas</small>
              </div>
            </div>
            <p>
              {recentAccuracy === null
                ? "Conclua um treino para gerar este sinal."
                : `${recentResponseCount} respostas compõem esta leitura.`}
            </p>
          </div>
        </Panel>

        <section className="dash-loop" aria-label="Ciclo de aprendizagem">
          {[
            { icon: <Target />, label: "Treinar", value: completedCount },
            { icon: <TriangleAlert />, label: "Diagnosticar", value: weak.length },
            { icon: <Repeat2 />, label: "Revisar", value: dueItems.length },
            { icon: <Crosshair />, label: "Consolidar", value: consolidatedAreas },
          ].map((step, index) => (
            <div className="dash-loop__step" key={step.label}>
              <span>{step.icon}</span>
              <div>
                <small>0{index + 1}</small>
                <strong>{step.label}</strong>
              </div>
              <b>{step.value}</b>
            </div>
          ))}
        </section>

        <Panel className="dash-evolution" labelledBy="evolution-title">
          <PanelHeading
            id="evolution-title"
            eyebrow="trajetória"
            title="Evolução de desempenho"
            action={<span className="dash-chip">média móvel</span>}
          />
          <div className="dash-chart">
            {evolution.length >= 2 ? (
              <EvolutionArea values={evolution} />
            ) : (
              <div className="dash-empty-chart">
                <TrendingUp aria-hidden="true" />
                <span>A série aparece após duas medições.</span>
              </div>
            )}
          </div>
          <div className="dash-evolution__metrics">
            <Metric
              label="variação"
              value={delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta} p.p.`}
              supporting="desde o início da série"
              icon={<TrendingUp />}
            />
            <Metric
              label="sessões"
              value={completedCount}
              supporting="corrigidas nesta prova"
              icon={<BarChart3 />}
              spark={sessionsPerWeek}
            />
            <Metric
              label="tempo total"
              value={totalTime ? shortSec(totalTime) : "—"}
              supporting="em sessões concluídas"
              icon={<Clock3 />}
            />
          </div>
        </Panel>

        <Panel className="dash-reviews" labelledBy="reviews-title">
          <PanelHeading
            id="reviews-title"
            eyebrow="retenção"
            title="Revisões"
            action={
              <Link href="/srs">
                Ver fila <ArrowRight size={13} />
              </Link>
            }
          />
          {dueItems.length ? (
            <ol className="dash-list">
              {dueItems.slice(0, 4).map((item) => (
                <li key={item.key}>
                  <span className="dash-list__marker dash-list__marker--urgent" />
                  <div>
                    <strong>{item.content || item.discipline || "Questão para revisar"}</strong>
                    <small>
                      {examLabel(item.providerId)} {item.year} · questão {item.index}
                    </small>
                  </div>
                  <b>{item.reps}×</b>
                </li>
              ))}
            </ol>
          ) : (
            <div className="dash-empty">
              <CheckCircle2 aria-hidden="true" />
              <strong>Fila em dia</strong>
              <span>Os próximos itens aparecem no momento certo.</span>
            </div>
          )}
        </Panel>

        <Panel className="dash-mastery" labelledBy="mastery-title">
          <PanelHeading
            id="mastery-title"
            eyebrow="cobertura"
            title="Mapa de domínio"
            action={
              <Link href="/mastery">
                Detalhes <ArrowRight size={13} />
              </Link>
            }
          />
          <div className="dash-mastery__list">
            {areas.map((area) => (
              <div className="dash-mastery__row" key={area.id}>
                <div>
                  <span>{area.label}</span>
                  <small>{area.sample ? `${area.sample} respostas` : "sem amostra"}</small>
                </div>
                <div className="dash-meter" aria-hidden="true">
                  <span style={{ width: `${area.score ?? 0}%` }} />
                </div>
                <strong>{area.score === null ? "—" : `${area.score}%`}</strong>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="dash-bottlenecks" labelledBy="bottlenecks-title">
          <PanelHeading
            id="bottlenecks-title"
            eyebrow="prioridade"
            title="Gargalos"
            action={<span className="dash-chip dash-chip--warning">por impacto</span>}
          />
          {weak.length ? (
            <ol className="dash-ranking">
              {weak.map((item, index) => (
                <li key={item.name}>
                  <span>0{index + 1}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.t} questões medidas</small>
                  </div>
                  <b>{item.p}%</b>
                </li>
              ))}
            </ol>
          ) : (
            <div className="dash-empty">
              <TriangleAlert aria-hidden="true" />
              <strong>Ainda sem gargalos medidos</strong>
              <span>O ranking surge conforme você responde questões.</span>
            </div>
          )}
        </Panel>

        <Panel className="dash-insights" labelledBy="insights-title">
          <PanelHeading id="insights-title" eyebrow="leitura automática" title="Insights" />
          <div className="dash-insights__list">
            <article>
              <Sparkles aria-hidden="true" />
              <div>
                <strong>
                  {weak.length ? `${weak[0].name} pede atenção` : "Calibre o diagnóstico"}
                </strong>
                <p>
                  {weak.length
                    ? `${weak[0].p}% de acerto em ${weak[0].t} questões recentes desse tópico.`
                    : "Uma primeira sessão já permite localizar seus principais gargalos."}
                </p>
              </div>
            </article>
            <article>
              <Repeat2 aria-hidden="true" />
              <div>
                <strong>{dueItems.length ? "Retenção em risco" : "Retenção protegida"}</strong>
                <p>
                  {dueItems.length
                    ? `${dueItems.length} ${dueItems.length === 1 ? "item está" : "itens estão"} aguardando revisão.`
                    : "Nenhuma revisão está vencida para a prova ativa."}
                </p>
              </div>
            </article>
            <article>
              <TrendingUp aria-hidden="true" />
              <div>
                <strong>
                  {delta === null
                    ? "Tendência ainda aberta"
                    : delta >= 0
                      ? "Tendência positiva"
                      : "Oscilação recente"}
                </strong>
                <p>
                  {delta === null
                    ? "São necessárias ao menos duas medições para comparar evolução."
                    : `${delta > 0 ? "+" : ""}${delta} ponto${Math.abs(delta) === 1 ? "" : "s"} percentual na série disponível.`}
                </p>
              </div>
            </article>
          </div>
        </Panel>

        <Panel className="dash-attempts" labelledBy="attempts-title">
          <PanelHeading
            id="attempts-title"
            eyebrow="histórico"
            title="Tentativas recentes"
            action={
              <Link href="/history">
                Ver todas <ArrowRight size={13} />
              </Link>
            }
          />
          {recentAttempts.length ? (
            <div className="dash-attempts__table">
              {recentAttempts.map((attempt) => (
                <Link href={`/result/${attempt.id}`} key={attempt.id}>
                  <span className="dash-attempts__icon">
                    <CheckCircle2 aria-hidden="true" />
                  </span>
                  <span>
                    <strong>
                      {attempt.mode === "srs"
                        ? "Revisão espaçada"
                        : attempt.mode === "retry"
                          ? "Revisão de erros"
                          : `${examLabel(attempt.providerId)} ${attempt.year}`}
                    </strong>
                    <small>
                      {attempt.result!.total} questões · {shortSec(attempt.elapsed)}
                    </small>
                  </span>
                  <b>{pct(attempt.result!.correct, attempt.result!.total)}%</b>
                  <time>{dashboardRelativeTime(attempt.finishedAt!, now)}</time>
                </Link>
              ))}
            </div>
          ) : (
            <div className="dash-empty dash-empty--wide">
              <FileText aria-hidden="true" />
              <strong>Nenhuma sessão concluída</strong>
              <span>Corrija um treino para começar sua linha de desempenho.</span>
              <Button asChild variant="secondary" size="sm">
                <Link href="/practice">Montar treino</Link>
              </Button>
            </div>
          )}
        </Panel>

        <Panel className="dash-exams" labelledBy="exams-title">
          <PanelHeading id="exams-title" eyebrow="visão geral" title="Multi-prova" />
          <div className="dash-exams__list">
            {providerSummaries.map((provider) => (
              <div className={provider.id === providerId ? "is-active" : ""} key={provider.id}>
                <span className="dash-exams__badge">{provider.label.slice(0, 2)}</span>
                <span>
                  <strong>{provider.label}</strong>
                  <small>
                    {provider.attempts ? `${provider.attempts} sessões` : "prova ativa"}
                  </small>
                </span>
                <b>{provider.accuracy === null ? "—" : `${provider.accuracy}%`}</b>
              </div>
            ))}
          </div>
        </Panel>

        <section className="dash-activity" aria-labelledby="activity-title">
          <header>
            <div>
              <p>atividade recente</p>
              <h2 id="activity-title">Linha do tempo</h2>
            </div>
            <Activity aria-hidden="true" />
          </header>
          <div className="dash-activity__grid">
            <article>
              <small>hoje</small>
              <strong>{questionsToday} questões respondidas</strong>
              <span>{dailyProgress}% da meta diária</span>
            </article>
            <article>
              <small>sequência</small>
              <strong>
                {streak} {streak === 1 ? "dia ativo" : "dias ativos"}
              </strong>
              <span>{activeDays.filter(Boolean).length} dias nesta semana</span>
            </article>
            <article>
              <small>amostra</small>
              <strong>{totalQuestions} respostas medidas</strong>
              <span>confiança estatística {confidence.label}</span>
            </article>
            <article>
              <small>próximo passo</small>
              <strong>{mission.title}</strong>
              <Link href={mission.href}>
                Abrir <ArrowRight size={13} />
              </Link>
            </article>
          </div>
        </section>
      </div>

      <footer className="dashboard-footer">
        <span>ENEM Lab · desempenho baseado no seu histórico real</span>
        <span>
          <BookOpen aria-hidden="true" /> {examLabel(providerId)}
        </span>
      </footer>
    </div>
  );
}
