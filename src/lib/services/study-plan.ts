import { adaptiveCandidates } from "../domain/adaptive";
import { officialRowsOf, weakestContents } from "../domain/stats";
import { dueSRS } from "../domain/srs";
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
  const weak = weakestContents(db, 5, scoped).filter((item) => item.p < 65);
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
        ? `${weak.length} conteúdo(s) abaixo de 65%; pior sinal: ${weak[0].name} (${weak[0].p}%).`
        : "Nenhum conteúdo medido abaixo de 65%.",
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
        ? `${history} resposta(s) históricas alimentam o próximo treino adaptativo.`
        : "Sem histórico: o primeiro bloco será composto por questões inéditas.",
      count: history,
      active: next.kind === "unseen" || next.kind === "adaptive",
      done: false,
    },
  ];
}
