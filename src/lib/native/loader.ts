import { CLOUD_CONFIGURED, ensureFreshSession, loadSession } from "../cloud/client";
import { classifyQuestion, questionKey } from "../domain/classify";
import type { Question } from "../domain/types";
import { createNativeSignedUrls, fetchPublishedNativePack, nativePageAssetPath } from "./cloud";
import type { NativePack, NativeQuestionContentRecord } from "./contracts";

interface NativeGroup {
  providerId: string;
  year: number;
  editionId?: string;
  phase: string;
  questions: Question[];
}

const LEGACY_PIPELINE_RE = /^native-pipeline@1(?:\.|$)/;
const LEGACY_PREVIOUS_CONTEXT_RE =
  /\b(?:romance|poema|obra|trecho|texto|narrador|eu\s+l[ií]rico|versos?|estrofes?|ensaio|passagem|excerto)\b/i;

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

function recordMatchesQuestion(record: NativeQuestionContentRecord, question: Question): boolean {
  return (
    record.questionKey === questionKey(question) &&
    record.providerId === (question.providerId ?? "enem") &&
    record.year === question.year &&
    (record.editionId ?? undefined) === (question.editionId ?? undefined) &&
    record.phase === (question.phase ?? "single") &&
    record.number === (question.number ?? question.index)
  );
}

function isPipelineV2(record: NativeQuestionContentRecord): boolean {
  const match = /^native-pipeline@(\d+)(?:\.|$)/.exec(record.extraction.parserVersion);
  return !!match && Number(match[1]) >= 2;
}

function documentForRecord(pack: NativePack, record: NativeQuestionContentRecord) {
  return pack.documents.find((document) => document.documentId === record.documentId);
}

function legacyNeedsPreviousContext(record: NativeQuestionContentRecord): boolean {
  return LEGACY_PREVIOUS_CONTEXT_RE.test(record.semantic.rawText ?? "");
}

/**
 * Packs v1 foram produzidos antes do gate de completude visual e podem ter
 * recortes geometricamente válidos, porém pedagogicamente incompletos. Para
 * eles o runner prefere a página rasterizada inteira (e, quando há referência
 * textual a um estímulo externo, também a página anterior). É mais conservador
 * e um pouco menos compacto, mas nunca corta figura, coluna ou alternativas.
 */
function legacyPagePaths(
  record: NativeQuestionContentRecord,
  pack: NativePack,
): string[] | null {
  const document = documentForRecord(pack, record);
  if (!document || !record.visualRegions.length) return null;
  const regionPages = [...new Set(record.visualRegions.map((region) => region.page))];
  if (!regionPages.length) return null;

  const pages: number[] = [];
  const firstPage = Math.min(...regionPages);
  if (legacyNeedsPreviousContext(record) && firstPage > 1) pages.push(firstPage - 1);
  for (const page of regionPages) {
    if (!pages.includes(page)) pages.push(page);
  }
  return pages.map((page) => nativePageAssetPath(document.pageAssetPattern, page));
}

export function nativeVisualPaths(
  record: NativeQuestionContentRecord,
  pack: NativePack,
): string[] | null {
  if (LEGACY_PIPELINE_RE.test(record.extraction.parserVersion)) {
    return legacyPagePaths(record, pack);
  }

  const completeness = record.extraction.visualCompleteness;
  if (isPipelineV2(record) && !completeness) return null;
  if (completeness?.required && !completeness.resolved) return null;
  if (!record.visualRegions.length) return null;

  const paths: string[] = [];
  for (const region of record.visualRegions) {
    if (!region.assetPath) return null;
    paths.push(region.assetPath);
  }
  return paths;
}

function completeVisualUrls(
  record: NativeQuestionContentRecord,
  pack: NativePack,
  signedUrls: Map<string, string>,
): string[] | null {
  const paths = nativeVisualPaths(record, pack);
  if (!paths?.length) return null;
  const urls: string[] = [];
  for (const path of paths) {
    const signed = signedUrls.get(path);
    if (!signed) return null;
    urls.push(signed);
  }
  return urls;
}

/**
 * Aplica um pack já publicado a um conjunto de questões. O visual assinado é
 * tratado como canônico; o gabarito e a estrutura A–E continuam vindo do
 * provider original e nunca do NativePack.
 *
 * A aplicação é fail-closed por questão: registros com identidade divergente,
 * evidência v2 incompleta ou qualquer asset visual ausente permanecem em modo
 * referência. Packs v1 usam páginas inteiras como fallback de segurança.
 */
export function applyNativePackToQuestions(
  questions: Question[],
  pack: NativePack,
  signedUrls: Map<string, string>,
): Question[] {
  const records = new Map(pack.questions.map((record) => [record.questionKey, record]));
  return questions.map((question) => {
    const record = records.get(questionKey(question));
    if (!record || record.status !== "published" || !recordMatchesQuestion(record, question)) {
      return question;
    }

    const visualUrls = completeVisualUrls(record, pack, signedUrls);
    if (!visualUrls) return question;

    return {
      ...question,
      // A classificação precisa ser calculada enquanto o conteúdo original do
      // provider ainda está disponível. Depois o visual vira canônico e o texto
      // pode ser ocultado sem alterar mastery/SRS/adaptive.
      classificationSnapshot: question.classificationSnapshot ?? classifyQuestion(question),
      // O visual nativo contém enunciado, figuras e alternativas. No legado v1
      // ele pode ser a página inteira; no v2 são recortes com completude provada.
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
        .flatMap((record) => nativeVisualPaths(record, pack) ?? []);
      const signed = await createNativeSignedUrls(session.access_token, [...new Set(paths)]);
      out = applyNativePackToQuestions(out, pack, signed);
    }
    return out;
  } catch (error) {
    console.warn("Conteúdo nativo indisponível; usando fonte de referência.", error);
    return questions;
  }
}
