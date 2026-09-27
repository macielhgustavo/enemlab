import { ESSAY_THEMES } from "./constants";
import type {
  DB,
  EssayCompetencyId,
  EssayEvaluation,
  EssayEvaluationSource,
  EssayPractice,
} from "./types";
import { resolveProviderId } from "../providers";

export interface EssayThemeOption {
  id: string;
  title: string;
  source: EssayPractice["themeSource"];
  sourceLabel: string;
}

export const ESSAY_COMPETENCIES: {
  id: EssayCompetencyId;
  short: string;
  label: string;
}[] = [
  { id: "c1", short: "C1", label: "Domínio da modalidade escrita formal" },
  { id: "c2", short: "C2", label: "Compreensão do tema e repertório" },
  { id: "c3", short: "C3", label: "Seleção e organização de argumentos" },
  { id: "c4", short: "C4", label: "Coesão e mecanismos linguísticos" },
  { id: "c5", short: "C5", label: "Proposta de intervenção" },
];

const OWN_THEMES: EssayThemeOption[] = [
  {
    id: "project-ciencia",
    title: "Caminhos para ampliar a alfabetização científica entre jovens no Brasil",
    source: "project",
    sourceLabel: "Tema próprio do projeto",
  },
  {
    id: "project-cultura-digital",
    title: "Desafios para reduzir a desigualdade de acesso à cultura digital no Brasil",
    source: "project",
    sourceLabel: "Tema próprio do projeto",
  },
  {
    id: "project-cidades",
    title: "Caminhos para tornar as cidades brasileiras mais acessíveis e inclusivas",
    source: "project",
    sourceLabel: "Tema próprio do projeto",
  },
  {
    id: "project-desinformacao",
    title: "Desafios para fortalecer a educação midiática diante da desinformação",
    source: "project",
    sourceLabel: "Tema próprio do projeto",
  },
];

const OFFICIAL_REFERENCES: EssayThemeOption[] = [2023, 2022, 2021]
  .filter((year) => Boolean(ESSAY_THEMES[year]))
  .map((year) => ({
    id: `enem-${year}`,
    title: ESSAY_THEMES[year],
    source: "official-reference" as const,
    sourceLabel: `ENEM ${year} · referência oficial`,
  }));

export const ESSAY_THEME_LIBRARY = [...OWN_THEMES, ...OFFICIAL_REFERENCES];

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEssayPractice(input: {
  providerId?: string | null;
  theme: string;
  themeId?: string | null;
  themeSource?: EssayPractice["themeSource"];
  timeLimitMin?: number | null;
  now?: string;
}): EssayPractice {
  const now = input.now ?? new Date().toISOString();
  return {
    id: uid("essay"),
    providerId: resolveProviderId(input.providerId),
    themeId: input.themeId || null,
    theme: input.theme.trim(),
    themeSource: input.themeSource ?? "external",
    text: "",
    versions: [],
    repertoire: "",
    improvements: "",
    evaluations: [],
    elapsedSec: 0,
    timeLimitMin:
      input.timeLimitMin && input.timeLimitMin > 0
        ? Math.round(input.timeLimitMin)
        : null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };
}

export function essayPractices(db: DB, providerId?: string | null): EssayPractice[] {
  const scoped = providerId ? resolveProviderId(providerId) : null;
  return [...(db.essays ?? [])]
    .filter((essay) => !scoped || resolveProviderId(essay.providerId) === scoped)
    .sort(
      (a, b) =>
        +new Date(b.updatedAt || b.startedAt) -
        +new Date(a.updatedAt || a.startedAt),
    );
}

export function saveEssayVersion(
  essay: EssayPractice,
  input: {
    text: string;
    repertoire?: string;
    improvements?: string;
    elapsedSec?: number;
    now?: string;
  },
): EssayPractice {
  const now = input.now ?? new Date().toISOString();
  const text = input.text;
  essay.text = text;
  essay.repertoire = input.repertoire ?? essay.repertoire;
  essay.improvements = input.improvements ?? essay.improvements;
  essay.elapsedSec = Math.max(0, Math.round(input.elapsedSec ?? essay.elapsedSec));
  essay.versions ||= [];
  essay.versions.push({ at: now, text });
  if (essay.versions.length > 30) essay.versions.shift();
  essay.updatedAt = now;
  return essay;
}

export function finishEssayPractice(
  essay: EssayPractice,
  input: {
    text: string;
    repertoire?: string;
    improvements?: string;
    elapsedSec?: number;
    now?: string;
  },
): EssayPractice {
  const now = input.now ?? new Date().toISOString();
  saveEssayVersion(essay, { ...input, now });
  essay.finishedAt = now;
  essay.updatedAt = now;
  return essay;
}

function normalizedCompetencies(
  source: EssayEvaluationSource,
  competencies: Partial<Record<EssayCompetencyId, number>>,
): Partial<Record<EssayCompetencyId, number>> {
  if (source !== "self" && source !== "external") return {};
  const out: Partial<Record<EssayCompetencyId, number>> = {};
  for (const competency of ESSAY_COMPETENCIES) {
    const value = competencies[competency.id];
    if (!Number.isFinite(value)) continue;
    out[competency.id] = Math.max(0, Math.min(200, Math.round(Number(value) / 40) * 40));
  }
  return out;
}

export function recordEssayEvaluation(
  essay: EssayPractice,
  input: {
    source: EssayEvaluationSource;
    authorLabel?: string;
    competencies?: Partial<Record<EssayCompetencyId, number>>;
    feedback?: string;
    now?: string;
  },
): EssayEvaluation {
  const now = input.now ?? new Date().toISOString();
  const evaluation: EssayEvaluation = {
    id: uid("eval"),
    source: input.source,
    authorLabel:
      input.source === "self"
        ? "Autoavaliação"
        : input.authorLabel?.trim() || "Feedback externo/manual",
    at: now,
    competencies: normalizedCompetencies(input.source, input.competencies ?? {}),
    feedback: input.feedback?.trim() || "",
  };
  essay.evaluations ||= [];
  essay.evaluations.push(evaluation);
  essay.updatedAt = now;
  return evaluation;
}

export interface EssayCompetencyMetric {
  id: EssayCompetencyId;
  label: string;
  average: number | null;
  samples: number;
}

export function essayCompetencyProgress(
  db: DB,
  providerId: string = "enem",
): EssayCompetencyMetric[] {
  const evaluations = essayPractices(db, providerId).flatMap(
    (essay) => essay.evaluations ?? [],
  );
  return ESSAY_COMPETENCIES.map((competency) => {
    const values = evaluations
      .map((evaluation) => evaluation.competencies?.[competency.id])
      .filter((value): value is number => Number.isFinite(value));
    return {
      id: competency.id,
      label: competency.label,
      average: values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null,
      samples: values.length,
    };
  });
}

export type EssayNextAction =
  | { kind: "new"; title: string; reason: string; essayId?: undefined }
  | { kind: "review"; title: string; reason: string; essayId: string }
  | { kind: "competency"; title: string; reason: string; essayId?: undefined; competencyId: EssayCompetencyId };

export function nextEssayAction(db: DB, providerId: string = "enem"): EssayNextAction {
  const history = essayPractices(db, providerId);
  const unfinished = history.find((essay) => !essay.finishedAt);
  if (unfinished) {
    return {
      kind: "review",
      title: "Continuar a redação em andamento",
      reason: `“${unfinished.theme}” ainda não foi concluída.`,
      essayId: unfinished.id,
    };
  }

  if (!history.length) {
    return {
      kind: "new",
      title: "Escrever a primeira redação",
      reason: "Ainda não há uma redação independente registrada.",
    };
  }

  const latest = history[0];
  if (!(latest.evaluations ?? []).length) {
    return {
      kind: "review",
      title: "Avaliar a redação mais recente",
      reason: "Há texto concluído, mas nenhuma avaliação registrada para orientar o próximo treino.",
      essayId: latest.id,
    };
  }

  if (resolveProviderId(providerId) === "enem") {
    const measured = essayCompetencyProgress(db, providerId)
      .filter((metric) => metric.average !== null)
      .sort((a, b) => (a.average ?? 0) - (b.average ?? 0));
    if (measured[0]) {
      return {
        kind: "competency",
        title: `Priorizar ${measured[0].id.toUpperCase()}`,
        reason: `É a menor média entre as avaliações registradas: ${measured[0].average}/200 em ${measured[0].samples} registro(s). Não é nota oficial.`,
        competencyId: measured[0].id,
      };
    }
  }

  return {
    kind: "new",
    title: "Fazer uma nova redação",
    reason: "A redação mais recente já foi concluída e avaliada.",
  };
}
