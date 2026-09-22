import { dueSRS } from "./srs";
import {
  areaStats,
  evolutionSeries,
  rollingRows,
  statisticalConfidence,
  streakDays,
  weakestContents,
} from "./stats";
import type { DB } from "./types";
import { pct } from "../format";
import { listProviders, sameProvider } from "../providers";
import { examLabel } from "../providers/label";
import { areasOf } from "../providers/taxonomy";

export const DASHBOARD_WEEKDAYS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"] as const;

export interface DashboardMission {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}

export function dashboardGreeting(hour: number): string {
  if (hour < 5) return "Boa madrugada";
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function dashboardRelativeTime(value: string, now: Date): string {
  const hours = Math.floor((now.getTime() - new Date(value).getTime()) / 3_600_000);
  if (hours < 1) return "agora há pouco";
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

export function dashboardSparklinePoints(values: number[]): string | null {
  if (values.length < 2) return null;
  const maximum = Math.max(...values, 1);
  const minimum = Math.min(...values, 0);
  const span = maximum - minimum || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 96;
      const y = 27 - ((value - minimum) / span) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function buildDashboardModel(db: DB, providerId: string, now: Date) {
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
  const activeDays = DASHBOARD_WEEKDAYS.map((_, index) => {
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

  const mission: DashboardMission = inProgress
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

  return {
    recentAccuracy,
    recentResponseCount: recentRows.length,
    dueItems,
    streak,
    weak,
    evolution,
    completedCount: completed.length,
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
    introMessage: inProgress
      ? "Você tem uma sessão em aberto."
      : dueItems.length
        ? "Sua fila de revisão está pronta."
        : "Seu próximo ciclo de estudo está organizado.",
  };
}

export type DashboardModel = ReturnType<typeof buildDashboardModel>;
