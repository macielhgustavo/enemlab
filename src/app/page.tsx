"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
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
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { useActiveProvider } from "@/components/ExamSwitch";
import { pct, shortSec } from "@/lib/format";
import { areasOf } from "@/lib/providers/taxonomy";
import {
  areaStats,
  evolutionSeries,
  rollingRows,
  statisticalConfidence,
  streakDays,
  weakestContents,
} from "@/lib/domain/stats";
import { dueSRS } from "@/lib/domain/srs";
import { DashboardSkeleton, Sk } from "@/components/Skeleton";
import { Button } from "@/components/ui/button";
import { examLabel } from "@/lib/providers/label";
import { listProviders, sameProvider } from "@/lib/providers";

const EvolutionArea = dynamic(
  () => import("@/components/charts").then((module) => module.EvolutionArea),
  {
    ssr: false,
    loading: () => <Sk h={220} r={12} />,
  },
);

const WEEKDAYS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

function greeting(hour: number) {
  if (hour < 5) return "Boa madrugada";
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="dash-spark dash-spark--empty" />;
  const maximum = Math.max(...values, 1);
  const minimum = Math.min(...values, 0);
  const span = maximum - minimum || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 96;
      const y = 27 - ((value - minimum) / span) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

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

export default function HomePage() {
  const db = useStore((state) => state.db);
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  const [now] = useState(() => new Date());

  if (!hydrated) return <DashboardSkeleton />;

  const recentRows = rollingRows(db, 100, providerId);
  const recentAccuracy = recentRows.length
    ? pct(recentRows.filter((row) => row.isCorrect).length, recentRows.length)
    : null;
  const dueItems = dueSRS(db, providerId);
  const streak = streakDays(db, providerId);
  const stats = areaStats(db, providerId);
  const weak = weakestContents(db, 5, providerId);
  const evolution = evolutionSeries(db, undefined, undefined, providerId);
  const completed = db.attempts.filter(
    (attempt) => attempt.result && sameProvider(attempt.providerId, providerId),
  );
  const inProgress = db.attempts.find(
    (attempt) => !attempt.finishedAt && sameProvider(attempt.providerId, providerId),
  );

  const targetPerDay = Math.max(1, Math.round((db.goals.questions || 0) / 7));
  const todayKey = now.toISOString().slice(0, 10);
  const questionsToday = completed
    .filter((attempt) => new Date(attempt.finishedAt!).toISOString().slice(0, 10) === todayKey)
    .reduce((sum, attempt) => sum + (attempt.result?.total || 0), 0);
  const dailyProgress = Math.min(100, Math.round((questionsToday / targetPerDay) * 100));

  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const activeDays = WEEKDAYS.map((_, index) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + index);
    const key = day.toISOString().slice(0, 10);
    return completed.some(
      (attempt) => new Date(attempt.finishedAt!).toISOString().slice(0, 10) === key,
    );
  });

  const sessionsPerWeek: number[] = [];
  for (let offset = 7; offset >= 0; offset--) {
    const start = new Date(weekStart);
    start.setDate(start.getDate() - offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    sessionsPerWeek.push(
      completed.filter((attempt) => {
        const finished = new Date(attempt.finishedAt!);
        return finished >= start && finished < end;
      }).length,
    );
  }

  const totalQuestions = completed.reduce(
    (sum, attempt) => sum + (attempt.result?.total || 0),
    0,
  );
  const totalCorrect = completed.reduce(
    (sum, attempt) => sum + (attempt.result?.correct || 0),
    0,
  );
  const totalTime = completed.reduce((sum, attempt) => sum + (attempt.elapsed || 0), 0);
  const delta = evolution.length >= 2 ? Math.round(evolution.at(-1)! - evolution[0]) : null;
  const confidence = statisticalConfidence(totalCorrect, totalQuestions);

  const areas = areasOf(providerId).map(({ id, label }) => {
    const value = stats[id] || { c: 0, t: 0 };
    return {
      id,
      label,
      score: value.t ? pct(value.c, value.t) : null,
      sample: value.t,
    };
  });
  const consolidatedAreas = areas.filter(
    (area) => area.score !== null && area.score >= 70,
  ).length;

  const mission = inProgress
    ? {
        eyebrow: "sessão em andamento",
        title: `Retomar ${examLabel(inProgress.providerId)} ${inProgress.year}`,
        description: `${Object.keys(inProgress.answers || {}).length} de ${inProgress.questionRefs.length} respondidas`,
        href: `/exam/${inProgress.id}`,
        cta: "Continuar sessão",
      }
    : dueItems.length
      ? {
          eyebrow: "prioridade: retenção",
          title: `Revisar ${dueItems.length} ${dueItems.length === 1 ? "item" : "itens"}`,
          description: "Sua fila de repetição espaçada já está pronta.",
          href: "/srs",
          cta: "Iniciar revisão",
        }
      : weak.length
        ? {
            eyebrow: "prioridade: conteúdo frágil",
            title: weak[0].name,
            description: `${weak[0].t} questões medidas · ${weak[0].p}% de acerto`,
            href: "/plano",
            cta: "Treinar este tópico",
          }
        : {
            eyebrow: "calibração",
            title: "Montar seu primeiro treino",
            description: "Comece com uma sessão curta para calibrar o painel.",
            href: "/practice",
            cta: "Montar treino",
          };

  const recentAttempts = [...completed]
    .sort((a, b) => +new Date(b.finishedAt!) - +new Date(a.finishedAt!))
    .slice(0, 5);

  const providerSummaries = listProviders()
    .map((provider) => {
      const attempts = db.attempts.filter(
        (attempt) => attempt.result && sameProvider(attempt.providerId, provider.id),
      );
      const total = attempts.reduce((sum, attempt) => sum + (attempt.result?.total || 0), 0);
      const correct = attempts.reduce(
        (sum, attempt) => sum + (attempt.result?.correct || 0),
        0,
      );
      return {
        id: provider.id,
        label: provider.metadata.shortLabel,
        attempts: attempts.length,
        accuracy: total ? pct(correct, total) : null,
      };
    })
    .filter((provider) => provider.id === providerId || provider.attempts > 0)
    .slice(0, 6);

  function relativeTime(value: string) {
    const hours = Math.floor((now.getTime() - new Date(value).getTime()) / 3_600_000);
    if (hours < 1) return "agora há pouco";
    if (hours < 24) return `há ${hours}h`;
    const days = Math.floor(hours / 24);
    return `há ${days} ${days === 1 ? "dia" : "dias"}`;
  }

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
          <h1>{greeting(now.getHours())}.</h1>
          <p>
            {inProgress
              ? "Você tem uma sessão em aberto."
              : dueItems.length
                ? "Sua fila de revisão está pronta."
                : "Seu próximo ciclo de estudo está organizado."}
          </p>
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
              style={{ "--score": recentAccuracy ?? 0 } as React.CSSProperties}
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
                : `${recentRows.length} respostas compõem esta leitura.`}
            </p>
          </div>
        </Panel>

        <section className="dash-loop" aria-label="Ciclo de aprendizagem">
          {[
            { icon: <Target />, label: "Treinar", value: completed.length },
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
              value={completed.length}
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
                  <time>{relativeTime(attempt.finishedAt!)}</time>
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
