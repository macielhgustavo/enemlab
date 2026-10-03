// Ponto único de acesso a questões.
//
// O registry completo continua funcional para histórico, reconstrução de
// tentativas, auditorias e testes. O modo ENEM-only é um gate de produto
// (providers expostos/selecionáveis), não uma mutilação da infraestrutura.
//
// Enquanto o ENEM for a única prova ativa:
// - ENEM vem exclusivamente da API enem.dev;
// - NativePack/local drafts não alteram questões do ENEM;
// - outros providers seguem acessíveis internamente para preservar o trabalho
//   existente e permitir reativação sem migração destrutiva.
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

export async function questionsFor(
  providerId: string | null | undefined,
  { year, editionId, language, force }: QuestionQuery,
): Promise<Question[]> {
  const id = resolveProviderId(providerId);

  // Fonte única do ENEM no modo atual: sem overlay nativo/local.
  if (id === ENEM_PROVIDER_ID) {
    return fetchExam(year, language || "ingles", force);
  }

  // Infraestrutura histórica permanece intacta para reconstrução/auditoria.
  const provider = getProvider(id);
  const normalized = await provider.fetchQuestions({ year, editionId, language, force });
  const questions = normalized.map(toLegacyQuestion);
  const native = await applyPublishedNativeContent(questions);
  return applyLocalNativeDrafts(native);
}

export function providerMetadata(providerId?: string | null) {
  return getProvider(providerId).metadata;
}
