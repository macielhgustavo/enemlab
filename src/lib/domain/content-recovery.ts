import { pct } from "../format";
import { examLabel } from "../providers/label";
import { areaLabel } from "../providers/taxonomy";
import { DEFAULT_PROVIDER_ID, resolveProviderId } from "../providers/registry";
import { contentPath } from "./constants";
import {
  masteryStats,
  officialRowsOf,
  questionTagsByRow,
  wilsonInterval,
  type Wilson,
} from "./stats";
import { MIN_ACTIONABLE_CONTENT_SAMPLE } from "./weak-evidence";
import type { DB, KnewChoice } from "./types";

export type ContentRecoveryState = "untested" | "calibrating" | "weak" | "measured";

export interface ContentRecoveryEvidence {
  providerId: string;
  name: string;
  c: number;
  t: number;
  p: number | null;
  ci: Wilson | null;
  state: ContentRecoveryState;
  remainingForDecision: number;
}

export interface ContentRecoveryError {
  attemptId: string;
  key: string;
  year: number;
  index: number;
  area: string;
  confidence: string | null;
  timeSec: number;
  finishedAt: string | null;
  reason: string;
  text: string;
  knew: KnewChoice;
}

export interface RecoveryReference {
  label: string;
  url: string;
  note: string;
}

export interface ContentRecoveryResource {
  summary: string;
  formulas: string[];
  references: RecoveryReference[];
}

const ENEM_RESOURCES: Record<string, ContentRecoveryResource> = {
  "Porcentagem e juros": {
    summary:
      "Converta porcentagens em fatores multiplicativos antes de calcular. Em variações sucessivas, aplique os fatores em sequência em vez de somar percentuais diretamente.",
    formulas: ["p% = p / 100", "valor final = valor inicial × (1 ± p/100)", "M = C × (1 + i)^n"],
    references: [
      {
        label: "Khan Academy — Matemática",
        url: "https://pt.khanacademy.org/math",
        note: "Aulas e exercícios externos de aritmética, porcentagem e juros.",
      },
    ],
  },
  "Razão e proporcionalidade": {
    summary:
      "Identifique primeiro quais grandezas variam juntas e se a relação é direta ou inversa. Monte a proporção só depois de definir essa relação.",
    formulas: ["a / b = c / d  ⇒  a·d = b·c", "direta: y = kx", "inversa: y = k/x"],
    references: [
      {
        label: "Khan Academy — Matemática",
        url: "https://pt.khanacademy.org/math",
        note: "Referência externa para razões, taxas e proporcionalidade.",
      },
    ],
  },
  "Física • Mecânica": {
    summary:
      "Comece pelo diagrama e pelas grandezas conhecidas. Separe cinemática, forças e energia: escolher o modelo certo costuma ser mais importante que decorar muitas fórmulas.",
    formulas: ["v = Δs / Δt", "F_resultante = m·a", "E_c = m·v² / 2"],
    references: [
      {
        label: "Khan Academy — Física",
        url: "https://pt.khanacademy.org/science/physics",
        note: "Aulas e exercícios externos de mecânica.",
      },
    ],
  },
  "Química • Estequiometria": {
    summary:
      "Balanceie a equação antes de usar proporções. Converta as grandezas para mol, aplique a razão dos coeficientes e só então volte para massa, volume ou partículas.",
    formulas: ["n = m / M", "N = n·N_A", "razão molar = razão dos coeficientes balanceados"],
    references: [
      {
        label: "Khan Academy — Química",
        url: "https://pt.khanacademy.org/science/chemistry",
        note: "Referência externa para mol, equações e estequiometria.",
      },
    ],
  },
};

export function contentRecoveryHref(providerId: string | null | undefined, content: string): string {
  const scoped = resolveProviderId(providerId);
  return `/content/${encodeURIComponent(scoped)}/${encodeURIComponent(content)}`;
}

export function contentNoteKey(providerId: string | null | undefined, content: string): string {
  const scoped = resolveProviderId(providerId);
  return `content:${scoped}:${encodeURIComponent(content)}`;
}

export function contentRecoveryEvidence(
  db: DB,
  content: string,
  providerId: string = DEFAULT_PROVIDER_ID,
): ContentRecoveryEvidence {
  const scoped = resolveProviderId(providerId);
  const tally = masteryStats(db, scoped)[content] ?? { c: 0, t: 0 };
  const p = tally.t ? pct(tally.c, tally.t) : null;
  const ci = tally.t ? wilsonInterval(tally.c, tally.t) : null;
  const state: ContentRecoveryState =
    tally.t === 0
      ? "untested"
      : tally.t < MIN_ACTIONABLE_CONTENT_SAMPLE
        ? "calibrating"
        : (p ?? 100) < 65
          ? "weak"
          : "measured";

  return {
    providerId: scoped,
    name: content,
    ...tally,
    p,
    ci,
    state,
    remainingForDecision: Math.max(0, MIN_ACTIONABLE_CONTENT_SAMPLE - tally.t),
  };
}

export function recoveryTaxonomyPath(db: DB, content: string, providerId: string): string[] {
  const scoped = resolveProviderId(providerId);
  const canonical = contentPath(content);
  if (canonical.length > 1 || canonical[0] !== content) return canonical;

  const row = officialRowsOf(db, scoped).find((item) =>
    questionTagsByRow(db, item).includes(content),
  );
  const parts = [
    examLabel(scoped),
    row?.area ? areaLabel(row.area, scoped) : "",
    content,
  ].filter(Boolean);
  return [...new Set(parts)];
}

export function relatedContentErrors(
  db: DB,
  content: string,
  providerId: string,
  limit = 6,
): ContentRecoveryError[] {
  const scoped = resolveProviderId(providerId);
  return officialRowsOf(db, scoped)
    .filter(
      (row) =>
        row.isCorrect === false &&
        questionTagsByRow(db, row).includes(content),
    )
    .sort(
      (a, b) =>
        +(b.finishedAt ? new Date(b.finishedAt) : 0) -
        +(a.finishedAt ? new Date(a.finishedAt) : 0),
    )
    .slice(0, Math.max(0, limit))
    .map((row) => {
      const note = db.notes[`${row.attemptId}|${row.key}`] ?? {};
      return {
        attemptId: row.attemptId,
        key: row.key,
        year: row.year,
        index: row.index,
        area: row.area,
        confidence: row.confidence,
        timeSec: row.timeSec,
        finishedAt: row.finishedAt,
        reason: note.reason?.trim() ?? "",
        text: note.text?.trim() ?? "",
        knew: note.knew ?? "",
      };
    });
}

export function contentRecoveryResource(
  providerId: string,
  content: string,
): ContentRecoveryResource | null {
  return resolveProviderId(providerId) === "enem" ? ENEM_RESOURCES[content] ?? null : null;
}
