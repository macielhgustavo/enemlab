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
import { esaProvider } from "./esa";
import { eearProvider } from "./eear";
import { unicampProvider } from "./unicamp";
import { uelProvider } from "./uel";
import { pucSpProvider } from "./puc-sp";
import { udescProvider } from "./udesc";
import { acafeProvider } from "./acafe";
import { fatecProvider } from "./fatec";
import { unespProvider } from "./unesp";
import { unioesteProvider } from "./unioeste";

registerProvider(enemProvider);
registerProvider(itaProvider);
registerProvider(imeProvider);
registerProvider(fuvestProvider);
registerProvider(afaProvider);
registerProvider(epcarProvider);
registerProvider(espcexProvider);
registerProvider(esaProvider);
registerProvider(eearProvider);
registerProvider(unicampProvider);
registerProvider(uelProvider);
registerProvider(pucSpProvider);
registerProvider(udescProvider);
registerProvider(acafeProvider);
registerProvider(fatecProvider);
registerProvider(unespProvider);
registerProvider(unioesteProvider);

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
  esaProvider,
  esaMetadata,
  ESA_PROVIDER_ID,
  esaYears,
  esaAnswerKey,
  esaExamUrl,
  esaAnswerKeyUrl,
  esaQuestions,
  esaQuestionKey,
} from "./esa";
export {
  eearProvider,
  eearMetadata,
  EEAR_PROVIDER_ID,
  eearYears,
  eearEditions,
  eearAnswerKey,
  eearExamUrl,
  eearQuestions,
  eearQuestionKey,
  eearMeasure,
} from "./eear";
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
export {
  fatecProvider,
  fatecMetadata,
  FATEC_PROVIDER_ID,
  fatecYears,
  fatecEditions,
  fatecAnswerKey,
  fatecExamUrl,
  fatecQuestions,
  fatecQuestionKey,
  fatecMeasure,
} from "./fatec";
export {
  unespProvider,
  unespMetadata,
  UNESP_PROVIDER_ID,
  unespYears,
  unespAnswerKey,
  unespVariants,
  unespExamUrl,
  unespFirstPhaseQuestions,
  unespQuestionKey,
} from "./unesp";
export {
  unioesteProvider,
  unioesteMetadata,
  UNIOESTE_PROVIDER_ID,
  unioesteYears,
  unioesteAnswerKeys,
  unioesteExamUrl,
  unioesteQuestions,
  unioesteQuestionKey,
  unioesteMeasures,
} from "./unioeste";
