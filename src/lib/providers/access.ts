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
 * Conteúdo nativo importado pelo próprio usuário é aplicado somente no
 * navegador, depois que a identidade/gabarito do provider já foi resolvida.
 * Esse overlay não faz parte do DB persistido/sincronizado do Studium.
 */
export async function questionsFor(
  providerId: string | null | undefined,
  { year, editionId, language, force }: QuestionQuery,
): Promise<Question[]> {
  const id = resolveProviderId(providerId);

  if (id === ENEM_PROVIDER_ID) {
    const questions = await fetchExam(year, language || "ingles", force);
    return applyLocalNativeDrafts(questions);
  }

  const provider = getProvider(id);
  const normalized = await provider.fetchQuestions({ year, editionId, language, force });
  return applyLocalNativeDrafts(normalized.map(toLegacyQuestion));
}

/** Metadados da prova (anos, idiomas, áreas) para montar formulários. */
export function providerMetadata(providerId?: string | null) {
  return getProvider(providerId).metadata;
}
