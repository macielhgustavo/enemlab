// Ponto único de acesso aos providers. Importar daqui garante que o
// registry já está populado.
import { registerProvider } from "./registry";
import { enemProvider } from "./enem";
import { itaProvider } from "./ita";

registerProvider(enemProvider);
registerProvider(itaProvider);

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
