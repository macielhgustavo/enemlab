// Ponto único de acesso aos providers. Importar daqui garante que o
// registry já está populado.
import { registerProvider } from "./registry";
import { enemProvider } from "./enem";
import { itaProvider } from "./ita";
import { imeProvider } from "./ime";
import { fuvestProvider } from "./fuvest";
import { afaProvider } from "./afa";
import { epcarProvider } from "./epcar";

registerProvider(enemProvider);
registerProvider(itaProvider);
registerProvider(imeProvider);
registerProvider(fuvestProvider);
registerProvider(afaProvider);
registerProvider(epcarProvider);

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
export {
  fuvestProvider,
  fuvestMetadata,
  FUVEST_PROVIDER_ID,
  fuvestYears,
  fuvestAnswerKey,
  fuvestVariants,
  fuvestExamUrl,
  fuvestSecondPhaseUrls,
  fuvestFirstPhaseQuestions,
  fuvestQuestionKey,
} from "./fuvest";
export {
  afaProvider,
  afaMetadata,
  AFA_PROVIDER_ID,
  afaYears,
  afaAnswerKey,
  afaVariants,
  afaFirstPhaseQuestions,
  afaQuestionKey,
} from "./afa";
export {
  epcarProvider,
  epcarMetadata,
  EPCAR_PROVIDER_ID,
  epcarYears,
  epcarAnswerKey,
  epcarVariants,
  epcarFirstPhaseQuestions,
  epcarQuestionKey,
} from "./epcar";
