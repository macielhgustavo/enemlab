import { DEFAULT_PROVIDER_ID, resolveProviderId, sameProvider } from "../providers/registry";
import { classifyContent, questionKey } from "./classify";
import { contentEvidence, type EvidenceLevel } from "./study-intelligence";
import { officialRowsOf } from "./stats";
import type { DB, Question } from "./types";

export type DiagnosticEvidenceState = "untested" | "calibrating" | "calibrated";

export interface DiagnosticDecision {
  question: Question;
  questionKey: string;
  content: string;
  score: number;
  evidenceState: DiagnosticEvidenceState;
  confidence: EvidenceLevel;
  attemptsInContent: number;
  intervalWidth: number | null;
  seen: boolean;
  reasons: string[];
}

export interface DiagnosticSelection {
  providerId: string;
  requested: number;
  selected: DiagnosticDecision[];
  contents: number;
  untested: number;
  calibrating: number;
  calibrated: number;
  note: string;
}

function stableTieBreak(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * 2;
}

/**
 * Diagnóstico escolhe questões para reduzir incerteza, não para estimar nota.
 * Conteúdo não testado vem primeiro; depois amostra curta; depois os maiores
 * intervalos de confiança. O teto por conteúdo é best-effort: se o banco não
 * tiver diversidade suficiente, uma segunda passada completa o tamanho pedido.
 */
export function buildDiagnosticSelection(
  db: DB,
  all: Question[],
  providerId: string = DEFAULT_PROVIDER_ID,
  requested = 25,
  now: Date = new Date(),
): DiagnosticSelection {
  const scoped = resolveProviderId(providerId);
  const n = Math.min(30, Math.max(20, Math.round(requested)));
  const bank = all.filter((question) => sameProvider(question.providerId, scoped));
  const evidence = new Map(contentEvidence(db, scoped, now).map((item) => [item.content, item]));
  const seen = new Set(officialRowsOf(db, scoped).map((row) => row.key));

  const ranked: DiagnosticDecision[] = bank
    .map((question) => {
      const key = questionKey(question);
      const content = classifyContent(question);
      const current = evidence.get(content);
      const attempts = current?.total ?? 0;
      const evidenceState: DiagnosticEvidenceState = attempts === 0
        ? "untested"
        : attempts < 4
          ? "calibrating"
          : "calibrated";
      const isSeen = seen.has(key);
      const intervalWidth = current?.interval.width ?? null;
      const score =
        (evidenceState === "untested" ? 150 : evidenceState === "calibrating" ? 105 : 30) +
        (evidenceState === "calibrating" ? Math.max(0, 4 - attempts) * 10 : 0) +
        (intervalWidth ?? 45) * 0.7 +
        (isSeen ? -25 : 18) +
        stableTieBreak(key);
      const reasons: string[] = [];
      if (evidenceState === "untested") reasons.push("Conteúdo ainda não testado: alto ganho de informação.");
      if (evidenceState === "calibrating") reasons.push(`Amostra curta: n=${attempts}; ainda não sustenta uma conclusão.`);
      if (evidenceState === "calibrated" && intervalWidth !== null && intervalWidth > 40) {
        reasons.push(`IC95% ainda largo (${Math.round(intervalWidth)} pontos).`);
      }
      if (!isSeen) reasons.push("Questão inédita evita medir apenas memória do item.");
      return {
        question,
        questionKey: key,
        content,
        score,
        evidenceState,
        confidence: current?.confidence ?? "baixa",
        attemptsInContent: attempts,
        intervalWidth,
        seen: isSeen,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score || a.questionKey.localeCompare(b.questionKey));

  const target = Math.min(n, ranked.length);
  const contentCap = Math.max(1, Math.ceil(target * 0.2));
  const selected: DiagnosticDecision[] = [];
  const picked = new Set<string>();
  const perContent = new Map<string, number>();

  for (const decision of ranked) {
    if ((perContent.get(decision.content) ?? 0) >= contentCap) continue;
    selected.push(decision);
    picked.add(decision.questionKey);
    perContent.set(decision.content, (perContent.get(decision.content) ?? 0) + 1);
    if (selected.length >= target) break;
  }

  if (selected.length < target) {
    for (const decision of ranked) {
      if (picked.has(decision.questionKey)) continue;
      selected.push(decision);
      picked.add(decision.questionKey);
      if (selected.length >= target) break;
    }
  }

  return {
    providerId: scoped,
    requested: n,
    selected,
    contents: new Set(selected.map((item) => item.content)).size,
    untested: selected.filter((item) => item.evidenceState === "untested").length,
    calibrating: selected.filter((item) => item.evidenceState === "calibrating").length,
    calibrated: selected.filter((item) => item.evidenceState === "calibrated").length,
    note: "Diagnóstico de calibração: maximiza informação sobre lacunas; não é nota prevista nem simulado classificatório.",
  };
}
