// Ponto único de acesso a questões.
//
// Antes da v8 cada tela importava `fetchExam` do cliente do ENEM, o que
// deixava o provider embutido em toda a aplicação. Aqui o provider vira um
// parâmetro: adicionar uma prova nova passa a ser registrar um provider, sem
// tocar nas telas.
//
// Transição: a aplicação ainda consome o formato `Question` (herdado do ENEM).
// O alvo é `NormalizedQuestion`, e a ponte é o adaptador em `./legacy`.
import { fetchExam } from "../api/enem";
import type { Language, Question } from "../domain/types";
import { applyPublishedNativeContent } from "../native/loader";
import { applyLocalNativeDrafts } from "../native/localDraft";
import { ENEM_PROVIDER_ID } from "./enem";
import { toLegacyQuestion } from "./legacy";
import { getProvider, resolveProviderId } from "./registry";

export { toLegacyQuestion };

export interface QuestionQuery {
  year: number;
  editionId?: string;
  language?: Language;
  force?: boolean;
}

/**
 * Busca as questões de uma prova. `providerId` ausente resolve para ENEM,
 * o que mantém todo o código e os dados anteriores funcionando.
 *
 * Ordem dos overlays:
 * 1. provider resolve identidade e gabarito;
 * 2. NativePack realmente publicado acrescenta o visual assinado;
 * 3. bundle local opcional pode substituir somente texto, nunca gabarito.
 */
export async function questionsFor(
  providerId: string | null | undefined,
  { year, editionId, language, force }: QuestionQuery,
): Promise<Question[]> {
  const id = resolveProviderId(providerId);
  let questions: Question[];

  if (id === ENEM_PROVIDER_ID) {
    questions = await fetchExam(year, language || "ingles", force);
  } else {
    const provider = getProvider(id);
    const normalized = await provider.fetchQuestions({ year, editionId, language, force });
    questions = normalized.map(toLegacyQuestion);
  }

  const native = await applyPublishedNativeContent(questions);
  return applyLocalNativeDrafts(native);
}

/** Metadados da prova (anos, idiomas, áreas) para montar formulários. */
export function providerMetadata(providerId?: string | null) {
  return getProvider(providerId).metadata;
}
