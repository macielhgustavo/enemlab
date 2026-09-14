import { pct } from "../format";
import { DEFAULT_PROVIDER_ID } from "../providers/registry";
import { isUnclassifiedContent } from "./classify";
import { masteryStats, wilsonInterval, type Wilson } from "./stats";
import type { DB } from "./types";

/**
 * A própria tela de domínio já trata menos de quatro respostas como amostra
 * insuficiente. O motor de recomendação usa o mesmo limite para não transformar
 * ruído inicial em uma afirmação de "fraqueza".
 */
export const MIN_ACTIONABLE_CONTENT_SAMPLE = 4;

export interface ContentEvidence {
  name: string;
  c: number;
  t: number;
  p: number;
  ci: Wilson;
  state: "calibrating" | "actionable";
}

export function contentEvidence(
  db: DB,
  providerId: string = DEFAULT_PROVIDER_ID,
): ContentEvidence[] {
  return Object.entries(masteryStats(db, providerId))
    .filter(([name, value]) => value.t > 0 && !isUnclassifiedContent(name))
    .map(([name, value]) => ({
      name,
      ...value,
      p: pct(value.c, value.t),
      ci: wilsonInterval(value.c, value.t),
      state: value.t >= MIN_ACTIONABLE_CONTENT_SAMPLE ? "actionable" as const : "calibrating" as const,
    }))
    .sort((a, b) => a.p - b.p || b.t - a.t || a.name.localeCompare(b.name));
}

/** Conteúdos com evidência mínima suficiente para virar bloco de reparo. */
export function actionableWeakContents(
  db: DB,
  n = 5,
  providerId: string = DEFAULT_PROVIDER_ID,
): ContentEvidence[] {
  return contentEvidence(db, providerId)
    .filter((item) => item.state === "actionable" && item.p < 65)
    .slice(0, n);
}

/** Conteúdos já observados, mas ainda cedo demais para afirmar fraqueza. */
export function calibrationContents(
  db: DB,
  n = 5,
  providerId: string = DEFAULT_PROVIDER_ID,
): ContentEvidence[] {
  return contentEvidence(db, providerId)
    .filter((item) => item.state === "calibrating")
    .slice(0, n);
}
