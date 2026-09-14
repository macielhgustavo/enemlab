import { CLOUD_CONFIGURED, ensureFreshSession, loadSession } from "../cloud/client";
import { classifyQuestion, questionKey } from "../domain/classify";
import type { Question } from "../domain/types";
import { createNativeSignedUrls, fetchPublishedNativePack } from "./cloud";
import type { NativePack } from "./contracts";

interface NativeGroup {
  providerId: string;
  year: number;
  editionId?: string;
  phase: string;
  questions: Question[];
}

function groupKey(question: Question): string {
  return [
    question.providerId ?? "enem",
    String(question.year),
    question.editionId ?? "",
    question.phase ?? "single",
  ].join("|");
}

function groupsOf(questions: Question[]): NativeGroup[] {
  const groups = new Map<string, NativeGroup>();
  for (const question of questions) {
    const key = groupKey(question);
    let group = groups.get(key);
    if (!group) {
      group = {
        providerId: question.providerId ?? "enem",
        year: question.year,
        editionId: question.editionId,
        phase: question.phase ?? "single",
        questions: [],
      };
      groups.set(key, group);
    }
    group.questions.push(question);
  }
  return [...groups.values()];
}

/**
 * Aplica um pack já publicado a um conjunto de questões. O visual assinado é
 * tratado como canônico; o gabarito e a estrutura A–E continuam vindo do
 * provider original e nunca do NativePack.
 */
export function applyNativePackToQuestions(
  questions: Question[],
  pack: NativePack,
  signedUrls: Map<string, string>,
): Question[] {
  const records = new Map(pack.questions.map((record) => [record.questionKey, record]));
  return questions.map((question) => {
    const record = records.get(questionKey(question));
    if (!record || record.status !== "published") return question;

    const visualUrls = record.visualRegions
      .map((region) => (region.assetPath ? signedUrls.get(region.assetPath) : undefined))
      .filter((value): value is string => Boolean(value));
    if (!visualUrls.length) return question;

    return {
      ...question,
      // A classificação precisa ser calculada enquanto o conteúdo original do
      // provider ainda está disponível. Depois o visual vira canônico e o texto
      // pode ser ocultado sem alterar mastery/SRS/adaptive.
      classificationSnapshot: question.classificationSnapshot ?? classifyQuestion(question),
      // O recorte visual contém enunciado, figuras e alternativas com a
      // fidelidade da prova original. O texto semântico fica no pack para
      // busca/acessibilidade, sem substituir o visual no runner.
      context: undefined,
      alternativesIntroduction: undefined,
      alternatives: (question.alternatives ?? []).map((alternative) => ({
        ...alternative,
        text: "",
      })),
      files: [...visualUrls, ...(question.files ?? [])],
      statementAvailable: true,
    };
  });
}

/**
 * Tenta enriquecer questões com o corpus nativo privado. Falhas de rede,
 * sessão ou permissão não quebram estudo: o provider volta ao modo referência.
 */
export async function applyPublishedNativeContent(questions: Question[]): Promise<Question[]> {
  if (typeof window === "undefined" || !CLOUD_CONFIGURED || questions.length === 0) return questions;
  const stored = loadSession();
  if (!stored) return questions;

  try {
    const session = await ensureFreshSession(stored);
    let out = [...questions];
    for (const group of groupsOf(questions)) {
      const pack = await fetchPublishedNativePack(session.access_token, {
        providerId: group.providerId,
        year: group.year,
        editionId: group.editionId,
        phase: group.phase,
      });
      if (!pack) continue;
      const wanted = new Set(group.questions.map(questionKey));
      const paths = pack.questions
        .filter((record) => wanted.has(record.questionKey) && record.status === "published")
        .flatMap((record) => record.visualRegions.map((region) => region.assetPath).filter(Boolean)) as string[];
      const signed = await createNativeSignedUrls(session.access_token, [...new Set(paths)]);
      out = applyNativePackToQuestions(out, pack, signed);
    }
    return out;
  } catch (error) {
    console.warn("Conteúdo nativo indisponível; usando fonte de referência.", error);
    return questions;
  }
}
