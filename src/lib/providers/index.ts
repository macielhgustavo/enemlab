// Ponto único de acesso aos providers. Importar daqui garante que o
// registry já está populado.
import { registerProvider } from "./registry";
import { enemProvider } from "./enem";
import { itaProvider } from "./ita";
import { imeProvider } from "./ime";
import { fuvestProvider } from "./fuvest";
import { afaProvider } from "./afa";
import { epcarProvider } from "./epcar";
import { espcexProvider } from "./espcex";
import { unicampProvider } from "./unicamp";
import { uelProvider } from "./uel";
import { pucSpProvider } from "./puc-sp";
import { udescProvider } from "./udesc";
import { acafeProvider } from "./acafe";

registerProvider(enemProvider);
registerProvider(itaProvider);
registerProvider(imeProvider);
registerProvider(fuvestProvider);
registerProvider(afaProvider);
registerProvider(epcarProvider);
registerProvider(espcexProvider);
registerProvider(unicampProvider);
registerProvider(uelProvider);
registerProvider(pucSpProvider);
registerProvider(udescProvider);
registerProvider(acafeProvider);

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
export {
  espcexProvider,
  espcexMetadata,
  ESPCEX_PROVIDER_ID,
  espcexYears,
  espcexAnswerKey,
  espcexExamUrl,
  espcexAnswerKeyUrl,
  espcexQuestions,
  espcexQuestionKey,
} from "./espcex";
export {
  unicampProvider,
  unicampMetadata,
  UNICAMP_PROVIDER_ID,
  unicampYears,
  unicampAnswerKey,
  unicampVariants,
  unicampExamUrl,
  unicampFirstPhaseQuestions,
  unicampQuestionKey,
} from "./unicamp";
export {
  uelProvider,
  uelMetadata,
  UEL_PROVIDER_ID,
  uelYears,
  uelAnswerKey,
  uelVariants,
  uelExamUrl,
  uelFirstPhaseQuestions,
  uelQuestionKey,
} from "./uel";
export {
  pucSpProvider,
  pucSpMetadata,
  PUC_SP_PROVIDER_ID,
  pucSpYears,
  pucSpAnswerKey,
  pucSpVariants,
  pucSpExamUrl,
  pucSpQuestions,
  pucSpQuestionKey,
} from "./puc-sp";
export {
  udescProvider,
  udescMetadata,
  UDESC_PROVIDER_ID,
  udescYears,
  udescEditions,
  udescAnswerKeys,
  udescExamUrl,
  udescQuestions,
  udescQuestionKey,
} from "./udesc";
export {
  acafeProvider,
  acafeMetadata,
  ACAFE_PROVIDER_ID,
  acafeYears,
  acafeEditions,
  acafeAnswerKey,
  acafeExamUrl,
  acafeQuestions,
  acafeQuestionKey,
} from "./acafe";
