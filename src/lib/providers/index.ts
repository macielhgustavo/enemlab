// Ponto único de acesso aos providers. Importar daqui garante que o
// registry já está populado.
import { registerProvider } from "./registry";
import { enemProvider } from "./enem";
import { itaProvider } from "./ita";
import { imeProvider } from "./ime";

registerProvider(enemProvider);
registerProvider(itaProvider);
registerProvider(imeProvider);

export * from "./types";
export * from "./registry";
export { enemProvider, enemMetadata, ENEM_PROVIDER_ID, normalizeEnemQuestion } from "./enem";
export {
  itaProvider,
  itaMetadata,
  ITA_PROVIDER_ID,
  itaYears,
  itaAnswerKey,
  itaFirstPhaseUrl,
  itaSecondPhaseUrls,
  itaFirstPhaseQuestions,
  itaQuestionKey,
} from "./ita";
export {
  imeProvider,
  imeMetadata,
  IME_PROVIDER_ID,
  imeYears,
  imeEditions,
  imeEditionOfYear,
  imeAnswerKey,
  imeExamUrl,
  imeAnswerKeyUrl,
  imeObjectiveQuestions,
  imeQuestionKey,
} from "./ime";
