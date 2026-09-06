// Ponto único de acesso a questões.
//
// Antes da v8 cada tela importava `fetchExam` do cliente do ENEM, o que
// deixava o provider embutido em toda a aplicação. Aqui o provider vira um
// parâmetro: adicionar uma prova nova passa a ser registrar um provider, sem
// tocar nas telas.
//
// Transição: a aplicação ainda consome o formato `Question` (herdado do ENEM).
// O alvo é `NormalizedQuestion`, e este módulo é a ponte enquanto isso —
// por isso o adaptador abaixo é explícito em vez de escondido.
import { fetchExam } from "../api/enem";
import type { Language, Question } from "../domain/types";
import { ENEM_PROVIDER_ID } from "./enem";
import { getProvider, resolveProviderId } from "./registry";
import type { NormalizedQuestion } from "./types";

export interface QuestionQuery {
  year: number;
  language?: Language;
  force?: boolean;
}

/** Converte a forma normalizada de volta ao formato consumido hoje. */
export function toLegacyQuestion(q: NormalizedQuestion): Question {
  return {
    index: q.index,
    year: q.year,
    language: q.language,
    discipline: q.subject.area,
    context: q.context ?? undefined,
    alternativesIntroduction: q.alternativesIntroduction ?? undefined,
    alternatives: q.alternatives.map((a) => ({
      letter: a.letter,
      text: a.text ?? "",
      file: a.file,
      isCorrect: a.isCorrect,
    })),
    correctAlternative: q.correctAlternative ?? undefined,
    files: q.files,
  };
}

/**
 * Busca as questões de uma prova. `providerId` ausente resolve para ENEM,
 * o que mantém todo o código e os dados anteriores funcionando.
 */
export async function questionsFor(
  providerId: string | null | undefined,
  { year, language, force }: QuestionQuery,
): Promise<Question[]> {
  const id = resolveProviderId(providerId);

  // O ENEM mantém o caminho direto: a normalização seguida de conversão
  // custaria uma volta inteira sem ganho enquanto ele é o único provider.
  if (id === ENEM_PROVIDER_ID) {
    return fetchExam(year, language || "ingles", force);
  }

  const provider = getProvider(id);
  const normalized = await provider.fetchQuestions({ year, language, force });
  return normalized.map(toLegacyQuestion);
}

/** Metadados da prova (anos, idiomas, áreas) para montar formulários. */
export function providerMetadata(providerId?: string | null) {
  return getProvider(providerId).metadata;
}
