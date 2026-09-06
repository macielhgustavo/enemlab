// Adaptador único de `NormalizedQuestion` para `Question`.
//
// `Question` é o formato herdado do ENEM, que o runner, o Banco e a correção
// ainda consomem. `NormalizedQuestion` é o alvo. Enquanto os dois existirem,
// a conversão mora **aqui e só aqui**: chegou a haver duas cópias — uma no
// acesso a questões e outra no serviço do ITA — e elas divergiam em qual campo
// virava `discipline`. Divergência silenciosa nesse ponto mistura o domínio de
// duas provas, que é justamente o defeito que a v8.0.1 veio fechar.
import type { Question } from "../domain/types";
import type { NormalizedQuestion } from "./types";

/**
 * Converte a forma normalizada de volta ao formato consumido hoje.
 *
 * `discipline` recebe `subject.area`, não `subject.id`. Nas provas de matéria
 * única os dois coincidem (no ITA, `area === id`); a distinção importa no
 * ENEM, onde várias disciplinas caem sob uma área.
 */
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
    // Procedência precisa sobreviver à conversão: sem isto o Banco e o runner
    // não sabem que a questão é de prova digitalizada.
    number: q.number,
    statementAvailable: q.statementAvailable,
    official: q.official,
  };
}
