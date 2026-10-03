// Ponto único de acesso a questões executáveis.
//
// O registry completo preserva vestibulares para histórico e ingestão, mas o
// produto está temporariamente em modo ENEM-only:
// - ENEM vem exclusivamente da API enem.dev;
// - NativePack/local drafts não alteram questões do ENEM;
// - providers inativos falham fechado ao tentar abrir uma nova sessão.
import { fetchExam } from "../api/enem";
import type { Language, Question } from "../domain/types";
import { applyPublishedNativeContent } from "../native/loader";
import { applyLocalNativeDrafts } from "../native/localDraft";
import { ENEM_PROVIDER_ID } from "./enem";
import { toLegacyQuestion } from "./legacy";
import { getProvider, isProviderEnabled, resolveProviderId } from "./registry";

export { toLegacyQuestion };

export interface QuestionQuery {
  year: number;
  editionId?: string;
  language?: Language;
  force?: boolean;
}

export class ProviderDisabledError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(
      `O provider "${providerId}" está temporariamente desativado. O Studium está usando apenas a API do ENEM.`,
    );
    this.name = "ProviderDisabledError";
    this.providerId = providerId;
  }
}

export async function questionsFor(
  providerId: string | null | undefined,
  { year, editionId, language, force }: QuestionQuery,
): Promise<Question[]> {
  const id = resolveProviderId(providerId);
  if (!isProviderEnabled(id)) throw new ProviderDisabledError(id);

  // Fonte única enquanto o modo ENEM-only estiver ativo.
  if (id === ENEM_PROVIDER_ID) {
    return fetchExam(year, language || "ingles", force);
  }

  // Mantido para reativação futura sem reconstruir a arquitetura.
  const provider = getProvider(id);
  const normalized = await provider.fetchQuestions({ year, editionId, language, force });
  const questions = normalized.map(toLegacyQuestion);
  const native = await applyPublishedNativeContent(questions);
  return applyLocalNativeDrafts(native);
}

export function providerMetadata(providerId?: string | null) {
  return getProvider(providerId).metadata;
}
