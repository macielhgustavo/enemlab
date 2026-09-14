import type { DailyPlanBlock } from "../domain/daily-plan";
import type { Attempt, DB } from "../domain/types";
import { ENEM_PROVIDER_ID, resolveProviderId } from "../providers";
import {
  buildAdaptiveAttempt,
  buildContentSprintAttempt,
  buildDueReviewsAttempt,
  buildTrainingAttempt,
} from "./attempts";
import {
  buildNextStudyAttempt,
  buildProviderAdaptiveAttempt,
  buildProviderContentAttempt,
  buildProviderUnseenAttempt,
} from "./provider-study";

function assertProvider(attempt: Attempt, providerId: string): Attempt {
  const actual = resolveProviderId(attempt.providerId);
  if (actual !== providerId) {
    throw new Error(`Bloco do plano resolveu para a prova errada: ${actual}.`);
  }
  return attempt;
}

/**
 * Constrói exatamente o bloco mostrado pelo Plano Diário na prova ativa.
 *
 * O plano sempre foi calculado por provider, mas a UI antiga chamava builders
 * ENEM-específicos para conteúdo, Adaptive e inéditas. Centralizar a execução
 * aqui impede que uma recomendação de UNESP/FATEC/etc. abra questões do ENEM.
 */
export async function buildDailyPlanBlockAttempt(
  db: DB,
  block: DailyPlanBlock,
  providerId: string,
): Promise<Attempt> {
  const scoped = resolveProviderId(providerId);

  if (scoped !== ENEM_PROVIDER_ID) {
    let attempt: Attempt;
    if (block.kind === "srs") {
      // O ciclo genérico resolve SRS pela questionKey exata, inclusive quando
      // há várias edições da mesma banca no mesmo ano.
      attempt = await buildNextStudyAttempt(db, scoped, block.questions);
      if (attempt.mode !== "srs") {
        throw new Error("O bloco de retenção ficou desatualizado; recalcule o plano.");
      }
    } else if (block.kind === "weak") {
      if (!block.content) throw new Error("Bloco de conteúdo sem tópico definido.");
      attempt = await buildProviderContentAttempt(scoped, block.content, block.questions);
    } else if (block.kind === "adaptive") {
      attempt = await buildProviderAdaptiveAttempt(db, scoped, block.questions);
    } else {
      attempt = await buildProviderUnseenAttempt(db, scoped, block.questions);
    }
    return assertProvider(attempt, scoped);
  }

  let attempt: Attempt;
  if (block.kind === "srs") {
    attempt = await buildDueReviewsAttempt(db, block.questions, scoped);
  } else if (block.kind === "weak") {
    if (!block.content) throw new Error("Bloco de conteúdo sem tópico definido.");
    attempt = await buildContentSprintAttempt(block.content, block.questions);
  } else if (block.kind === "adaptive") {
    attempt = await buildAdaptiveAttempt(db, block.questions);
  } else {
    attempt = await buildTrainingAttempt(db, {
      year: 2023,
      lang: "ingles",
      mode: block.questions > 15 ? "unseen30" : "unseen15",
      area: "all",
      minutes: Math.max(35, block.minutes),
      strict: false,
      strategy: false,
      alerts: true,
    });
  }
  return assertProvider(attempt, scoped);
}
