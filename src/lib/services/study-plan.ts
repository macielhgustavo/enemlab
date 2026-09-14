import { adaptiveCandidates } from "../domain/adaptive";
import { officialRowsOf } from "../domain/stats";
import { dueSRS } from "../domain/srs";
import { actionableWeakContents, calibrationContents } from "../domain/weak-evidence";
import type { DB } from "../domain/types";
import { resolveProviderId } from "../providers";
import { nextStudyAction, type StudyActionKind } from "./provider-study";

export interface StudyPlanStep {
  kind: StudyActionKind;
  title: string;
  detail: string;
  count: number;
  active: boolean;
  done: boolean;
}

/**
 * Explica a fila do motor adaptativo usando exatamente os mesmos sinais que
 * escolhem a próxima tentativa. Não cria um segundo algoritmo de prioridade.
 */
export function studyPlan(db: DB, providerId: string): StudyPlanStep[] {
  const scoped = resolveProviderId(providerId);
  const next = nextStudyAction(db, scoped);
  const due = dueSRS(db, scoped).length;
  const weak = actionableWeakContents(db, 5, scoped);
  const calibrating = calibrationContents(db, 5, scoped);
  const retries = adaptiveCandidates(db, scoped).length;
  const history = officialRowsOf(db, scoped).length;

  return [
    {
      kind: "review",
      title: "1. Retenção",
      detail: due ? `${due} revisão(ões) vencida(s).` : "Nenhuma revisão vencida.",
      count: due,
      active: next.kind === "review",
      done: due === 0,
    },
    {
      kind: "weakness",
      title: "2. Reparar lacunas",
      detail: weak.length
        ? `${weak.length} lacuna(s) com amostra mínima; pior sinal: ${weak[0].name} (${weak[0].p}% · n=${weak[0].t}).`
        : calibrating.length
          ? `Nenhuma lacuna confirmada; ${calibrating.length} conteúdo(s) ainda estão em calibração.`
          : "Nenhuma lacuna com evidência suficiente.",
      count: weak.length,
      active: next.kind === "weakness",
      done: weak.length === 0,
    },
    {
      kind: "retry",
      title: "3. Recuperar erros",
      detail: retries ? `${retries} erro(s) ainda priorizado(s).` : "Nenhum erro prioritário pendente.",
      count: retries,
      active: next.kind === "retry",
      done: retries === 0,
    },
    {
      kind: history ? "adaptive" : "unseen",
      title: "4. Nova amostra",
      detail: history
        ? calibrating.length
          ? `${history} resposta(s) históricas; ${calibrating.length} conteúdo(s) ainda precisam de mais amostra.`
          : `${history} resposta(s) históricas alimentam o próximo treino adaptativo.`
        : "Sem histórico: o primeiro bloco será composto por questões inéditas.",
      count: history,
      active: next.kind === "unseen" || next.kind === "adaptive",
      done: false,
    },
  ];
}
