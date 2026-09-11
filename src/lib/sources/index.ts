// Registry de fontes de prova.
import { itaYears, itaFirstPhaseUrl, itaSecondPhaseUrls } from "../providers/ita";
import { imeYears, imeExamUrl, imeAnswerKeyUrl, imeEditionOfYear } from "../providers/ime";
import { fuvestYears, fuvestExamUrl, fuvestSecondPhaseUrls } from "../providers/fuvest";
import { afaAnswerKey, afaYears } from "../providers/afa";
import { epcarAnswerKey, epcarYears } from "../providers/epcar";
import { espcexExamUrl, espcexYears } from "../providers/espcex";
import { esaExamUrl, esaYears } from "../providers/esa";
import { unicampExamUrl, unicampYears } from "../providers/unicamp";
import { uelExamUrl, uelYears } from "../providers/uel";
import { pucSpExamUrl, pucSpYears } from "../providers/puc-sp";
import { udescEditions, udescExamUrl, udescYears } from "../providers/udesc";
import { acafeEditions, acafeExamUrl, acafeYears } from "../providers/acafe";
import { examYears } from "../domain/constants";
import type { ExamImporter, ExamSourceDefinition, Provenance } from "./types";

export * from "./types";

const ITA_PARSER = "ita-answer-key@1.0.0";
const ENEM_PARSER = "enem-dev-api@1.0.0";
const IME_PARSER = "ime-answer-key@1.0.0";
const FUVEST_PARSER = "fuvest-answer-key@1.1.0";
const FAB_PARSER = "fab-answer-key@2.1.0";
const ESPCEX_PARSER = "espcex-answer-key@1.0.0";
const ESA_PARSER = "esa-answer-key@1.0.0";
const UNICAMP_PARSER = "unicamp-answer-key@1.0.0";
const UEL_PARSER = "uel-answer-key@1.0.0";
const PUC_SP_PARSER = "puc-sp-answer-key@1.0.0";
const UDESC_PARSER = "udesc-answer-key@1.0.0";
const ACAFE_PARSER = "acafe-answer-key@1.0.0";

/**
 * ENEM: API estruturada, com enunciado e alternativas em texto.
 */
export const enemSource: ExamSourceDefinition = {
  id: "enem-dev",
  providerId: "enem",
  institution: "INEP",
  archiveUrl: "https://api.enem.dev",
  sourceType: "structured-api",
  statementMode: "structured",
  extractionMethod: "api",
  rightsStatus: "allowed",
  family: "general",
  years: examYears(),
  phases: ["day1", "day2"],
  subjects: ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: ENEM_PARSER,
  lastVerifiedAt: "2026-09-05",
  confidence: "alta",
  discovery: "manual",
  notes: "Provas do INEP são de acesso público e a API entrega conteúdo estruturado.",
};

/**
 * ITA: arquivo oficial em PDF. As provas são digitalizadas (verificado: 0
 * caractere de texto, uma imagem por página), então o enunciado permanece na
 * fonte. Só o gabarito é ingerido, por ter camada de texto e ser dado factual.
 */
export const itaSource: ExamSourceDefinition = {
  id: "ita-official-archive",
  providerId: "ita",
  institution: "ITA",
  archiveUrl: "https://www.vestibular.ita.br/provas.htm",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  family: "engineering",
  years: itaYears(),
  phases: ["first", "second"],
  subjects: ["mathematics", "physics", "chemistry", "portuguese", "english"],
  answerKeyAvailable: true,
  // O ITA não publica resolução oficial estruturada da 2ª fase.
  expectedAnswersAvailable: false,
  parserVersion: ITA_PARSER,
  lastVerifiedAt: "2026-09-05",
  confidence: "alta",
  discovery: "manual",
  notes:
    "Enunciado não é reproduzido: é consultado no PDF oficial. Edições até 2018 " +
    "numeram por matéria e foram recusadas pela ingestão.",
};

/**
 * ENEM, arquivo oficial do INEP — **segunda fonte da mesma prova**.
 *
 * É o caso que o §15 pede provar: um provider com mais de uma fonte. A API
 * estruturada entrega enunciado em texto e vai de 2009 a 2023; o arquivo do
 * INEP cobre 1998 a 2025, mas em PDF.
 *
 * A regra é não trocar fonte boa por PDF pior. A estruturada continua sendo
 * a origem de 2009–2023; o INEP entra para o que ela não tem.
 *
 * Ainda **não ingerida**, e o motivo é concreto: o ENEM aplica vários
 * cadernos por dia (Azul, Amarelo, Branco, Rosa), que são a mesma prova em
 * ordem diferente. São 95 documentos só em 2025. Importar isso sem modelar
 * variante criaria quatro cópias de cada questão e um gabarito corrigindo o
 * caderno errado — o problema de `ExamVariant` que o escopo levanta no §19.
 *
 * A descoberta também não é trivial: a página do INEP monta a lista por
 * JavaScript, e o HTML servido tem zero link de PDF. As URLs seguem
 * `{ano}_{PV|GB}_impresso_D{dia}_CD{caderno}.pdf` — conferido em 2023, 2024
 * e 2025 —, mas §14 é explícito: não inferir arquivo por padrão de URL sem
 * verificar existência.
 */
export const enemOfficialSource: ExamSourceDefinition = {
  id: "inep-official-archive",
  providerId: "enem",
  institution: "INEP",
  archiveUrl:
    "https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem/provas-e-gabaritos",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  family: "general",
  // A página exige JavaScript para listar; descoberta automática por HTTP
  // simples não funciona aqui.
  discovery: "manual",
  // Vazio de propósito: nenhuma edição foi ingerida por esta fonte ainda.
  // Declarar 1998–2025 aqui faria o app prometer prova que não tem.
  years: [],
  phases: ["day1", "day2"],
  subjects: ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "inep-archive@0.0.0-nao-ingerido",
  lastVerifiedAt: "2026-09-06",
  confidence: "media",
  notes:
    "Registrada, não ingerida. Cobre 1998–2025 e é o único caminho para 2024 " +
    "e 2025, que a API estruturada não tem. Exige modelar caderno como " +
    "variante antes de qualquer importação.",
};

/**
 * IME: arquivo oficial do Concurso de Admissão ao CFG.
 *
 * `reference-only` por um motivo diferente do ITA, e a diferença importa
 * para quem adicionar a próxima prova. O ITA é digitalizado — não há texto.
 * O IME **tem** camada de texto, mas ela quebra a matemática: 67 frações
 * saem em três linhas e expoentes viram dígitos comuns, então a fórmula
 * mostrada seria diferente da que caiu na prova.
 *
 * "O PDF tem texto" não basta para decidir. O que decide é se o texto
 * preserva o significado.
 */
export const imeSource: ExamSourceDefinition = {
  id: "ime-cfg-archive",
  providerId: "ime",
  institution: "IME",
  archiveUrl:
    "https://www.ime.eb.mil.br/vestibular-e-concursos/cfg-ensino-medio/provas-anteriores-cfg",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  family: "engineering",
  discovery: "automatic",
  years: imeYears(),
  // A discursiva e a prova de línguas existem no arquivo e estão declaradas
  // aqui, mas não são executáveis: não há correção de discursiva, e
  // inventar uma seria pior que não ter.
  phases: ["first", "second"],
  subjects: ["mathematics", "physics", "chemistry"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: IME_PARSER,
  lastVerifiedAt: "2026-09-06",
  confidence: "alta",
  notes:
    "Objetiva com 40 questões (15 matemática, 15 física, 10 química) em todas " +
    "as oito edições ingeridas. O gabarito publicado é o final/definitivo. " +
    "Discursiva e línguas ficam como referência.",
};

/**
 * FUVEST: acervo oficial do vestibular.
 *
 * Primeira prova do catálogo com **variantes**. A FUVEST aplica a mesma
 * prova em várias versões reordenadas e publica um gabarito único com todas
 * em colunas — quatro versões em 2025 (V1..V4), cinco em 2024 (V, K, Q, X,
 * Z). O importador lê os nomes do documento; fixá-los no código faria o
 * parser recusar todo ano em que a banca mudasse a nomenclatura, ou pior,
 * atribuir a resposta à versão errada.
 *
 * `years` traz só as edições que o importador leu inteiras. Das 26 páginas
 * anuais do acervo atual, 22 são aceitas (2005–2026). As quatro anteriores
 * ficam bloqueadas porque a página oficial não associa um documento de
 * gabarito da 1ª fase. Recusar é o comportamento correto — meia leitura
 * corrige errado.
 */
export const fuvestSource: ExamSourceDefinition = {
  id: "fuvest-archive",
  providerId: "fuvest",
  institution: "FUVEST",
  archiveUrl: "https://www.fuvest.br/acervo-vestibular",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  family: "university",
  discovery: "automatic",
  years: fuvestYears(),
  // A 2ª fase é discursiva: registrada, não executável.
  phases: ["first", "second"],
  subjects: ["conhecimentos-gerais"],
  answerKeyAvailable: true,
  // A FUVEST publica respostas esperadas da 2ª fase, mas não há corretor
  // discursivo — declarar disponibilidade prometeria correção que não existe.
  expectedAnswersAvailable: false,
  parserVersion: FUVEST_PARSER,
  lastVerifiedAt: "2026-09-09",
  confidence: "alta",
  notes:
    "1ª fase com 100 questões em 2005–2006 e 90 de 2007 em diante. As 22 " +
    "edições de 2005–2026 somam 2.000 referências revisadas; 2001–2004 " +
    "ficam bloqueadas sem gabarito oficial inequívoco. Versões são " +
    "reordenação: só a canônica vira questão.",
};

/**
 * AFA: arquivo oficial da FAB, em modo referência.
 *
 * O gabarito final da versão A é dado factual e foi conferido por edição.
 * Os PDFs da prova permanecem na FAB: a extração não é distribuída como
 * texto porque fórmulas, diagramas e paginação não foram validados para cópia.
 */
export const afaSource: ExamSourceDefinition = {
  id: "afa-official-archive",
  providerId: "afa",
  institution: "FAB",
  archiveUrl: "https://www.fab.mil.br/ingresso/provas.html",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "air-force",
  discovery: "manual",
  years: afaYears(),
  phases: ["first"],
  subjects: ["portuguese", "mathematics", "english", "physics"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: FAB_PARSER,
  lastVerifiedAt: "2026-09-07",
  retrievalRoute: "web-archive",
  confidence: "media",
  notes:
    "Entram 2018–2025: oito edições, cada uma lida do gabarito oficial em PDF, " +
    "com 64 questões, versões A/B/C e anuladas preservadas. A ordem das matérias " +
    "sai do cabeçalho de cada documento e muda de ano para ano — 2021–2023 " +
    "começam por Inglês, as demais por Português —, e a divisão em blocos de 16 " +
    "foi conferida contra o caderno de prova em 2023, 2024 e 2025. " +
    "AFA 2026 fica de fora: a FAB a publica, mas nenhuma cópia do gabarito " +
    "final foi encontrada na verificação registrada, e ingerir sem ler o documento foi o " +
    "defeito que esta fonte passou a evitar.",
};

/** EPCAR: arquivo oficial da FAB, em modo referência. */
export const epcarSource: ExamSourceDefinition = {
  id: "epcar-official-archive",
  providerId: "epcar",
  institution: "FAB",
  archiveUrl: "https://www.fab.mil.br/ingresso/provas.html",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "air-force",
  discovery: "manual",
  years: epcarYears(),
  phases: ["first"],
  subjects: ["english", "mathematics", "portuguese"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: FAB_PARSER,
  lastVerifiedAt: "2026-09-07",
  retrievalRoute: "web-archive",
  confidence: "media",
  notes:
    "Entram 2018–2025: oito edições, cada uma lida do gabarito oficial em PDF, " +
    "com 48 questões, versões A/B/C e anuladas preservadas. A ordem das matérias " +
    "sai do cabeçalho de cada documento e não segue regra — 2021 aplica " +
    "Inglês/Português/Matemática, 2024 volta a Português/Matemática/Inglês —, " +
    "por isso ela nunca é assumida. Nenhuma edição teve a divisão em blocos de " +
    "16 confirmada contra o caderno de prova: os cadernos da EPCAR não estão " +
    "acessíveis, e as edições entram com `subjectBoundariesVerified: false`. " +
    "EPCAR 2026 fica de fora: esta ingestão não comprovou uma cópia final " +
    "oficial acessível. Isso não demonstra ausência de publicação.",
};

/** EsPCEx: concurso de admissão em dois dias, mantido em modo referência. */
export const espcexSource: ExamSourceDefinition = {
  id: "espcex-official-archive",
  providerId: "espcex",
  institution: "EsPCEx",
  archiveUrl: "https://espcex.eb.mil.br/",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "active",
  family: "army",
  discovery: "manual",
  years: espcexYears(),
  phases: ["day1", "day2"],
  subjects: ["portuguese", "physics", "chemistry", "mathematics", "geography", "history", "english"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: ESPCEX_PARSER,
  lastVerifiedAt: "2026-09-11",
  confidence: "alta",
  notes:
    "Entram 2024–2025 completos: 44 questões objetivas no 1º dia e 56 no 2º. " +
    "Os gabaritos finais apontam para URLs da EsPCEx. Em 2025 os cadernos também têm " +
    "URL oficial; em 2024 os cadernos verificáveis usados pelo app são espelhos públicos " +
    "e por isso as questões desse ano carregam `official: false`. O app não redistribui PDFs.",
};

/** ESA: Área Geral, Tipo A, mantida em modo referência. */
export const esaSource: ExamSourceDefinition = {
  id: "esa-general-reference",
  providerId: "esa",
  institution: "Escola de Sargentos das Armas",
  archiveUrl: "http://www.esa.eb.mil.br",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "permission-required",
  status: "active",
  family: "army",
  discovery: "manual",
  years: esaYears(),
  phases: ["single"],
  subjects: ["mathematics", "portuguese", "history_geography", "english"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: ESA_PARSER,
  lastVerifiedAt: "2026-09-11",
  confidence: "media",
  notes:
    "Entram 2021–2025 da Área Geral, Tipo A: 50 questões objetivas e redação por edição. " +
    "Os cadernos identificam a ESA e apontam esa.eb.mil.br como arquivo oficial; " +
    "a verificação disponível ao app usa espelhos públicos. Em 2024–2025 há PDFs diretos " +
    "do QConcursos; em 2021–2023 o fallback é a página pública de prova/questões do QConcursos. " +
    "Nenhuma URL espelhada é marcada como oficial e o app não redistribui os documentos.",
};

/** UNICAMP: arquivo oficial da COMVEST, 1ª fase objetiva em modo referência. */
export const unicampSource: ExamSourceDefinition = {
  id: "unicamp-comvest-archive",
  providerId: "unicamp",
  institution: "UNICAMP/COMVEST",
  archiveUrl: "https://www.comvest.unicamp.br/vestibulares-anteriores/",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "university",
  discovery: "manual",
  years: unicampYears(),
  phases: ["first", "second"],
  subjects: ["conhecimentos-gerais"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: UNICAMP_PARSER,
  lastVerifiedAt: "2026-09-08",
  confidence: "alta",
  notes:
    "Entram 2024–2026, somente 1ª fase objetiva. A COMVEST publica múltiplos " +
    "cadernos por edição; como a relação entre eles não foi demonstrada, a " +
    "ingestão marca `variantRelation: unknown`, registra todas as variantes e " +
    "executa apenas uma canônica por ano.",
};

/** UEL: COPS publica prova e gabarito definitivo do 1º dia. */
export const uelSource: ExamSourceDefinition = {
  id: "uel-cops-archive",
  providerId: "uel",
  institution: "UEL/COPS",
  archiveUrl:
    "https://www.cops.uel.br/v2/ProvasGabaritos/DivulgacaoProvasGabaritos1DiaVestibularDefinitivo/Selecao/370/Atividade/20969",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "university",
  discovery: "manual",
  years: uelYears(),
  phases: ["first", "second"],
  subjects: ["conhecimentos-gerais"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: true,
  parserVersion: UEL_PARSER,
  lastVerifiedAt: "2026-09-08",
  confidence: "alta",
  notes:
    "Entra 2026, 1º dia em inglês, com gabarito oficial definitivo e questão 41 " +
    "anulada. Tipos 1–3 foram encontrados; sem prova de reordenação, só o Tipo " +
    "1 vira executável. Espanhol e 2ª fase ficam registrados como cobertura " +
    "futura, sem runner discursivo nesta wave.",
};

/** PUC-SP: provider próprio, separado de PUC-PR e PUC-Rio. */
export const pucSpSource: ExamSourceDefinition = {
  id: "puc-sp-nucvest-archive",
  providerId: "puc-sp",
  institution: "PUC-SP/NucVest",
  archiveUrl: "https://nucvest.com.br/processos-anteriores.html",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "university",
  discovery: "manual",
  years: pucSpYears(),
  phases: ["single"],
  subjects: ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: PUC_SP_PARSER,
  lastVerifiedAt: "2026-09-08",
  confidence: "alta",
  notes:
    "Entram as edições de verão 2024–2026, com 50 questões e gabarito oficial. " +
    "A PUC-SP também publica edições de inverno no mesmo ano; elas foram " +
    "descobertas, mas não entram até a UI aceitar múltiplas edições no mesmo ano.",
};

/** UEM pesquisada e bloqueada por gabarito não A-E/somatória. */
export const uemResearchSource: ExamSourceDefinition = {
  id: "uem-cvu-research",
  providerId: "uem",
  institution: "UEM/CVU",
  archiveUrl: "https://www.cvu.uem.br/provas-gabaritos.html",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["single"],
  subjects: ["general"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "uem-research@0.1.0",
  lastVerifiedAt: "2026-09-08",
  confidence: "baixa",
  notes:
    "Arquivo oficial encontrado com provas/gabaritos, mas o formato usa " +
    "somatória/alternativas numéricas e alguns PDFs têm extração ruim. Não cabe " +
    "no runner A-E atual sem parser e experiência próprios.",
};

/** UEPG pesquisada e bloqueada por somatória. */
export const uepgResearchSource: ExamSourceDefinition = {
  id: "uepg-cps-research",
  providerId: "uepg",
  institution: "UEPG/CPS",
  archiveUrl: "https://www2.uepg.br/cps/vestibular-2025/",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["single"],
  subjects: ["general"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "uepg-research@0.1.0",
  lastVerifiedAt: "2026-09-08",
  confidence: "baixa",
  notes:
    "Página oficial e gabarito após recursos encontrados, mas o vestibular usa " +
    "questões de somatória. Importar como A-E corrigiria errado, então fica bloqueado.",
};

/** UNESP/Vunesp pesquisada, mas PDFs exigem Área do Candidato. */
export const unespResearchSource: ExamSourceDefinition = {
  id: "unesp-vunesp-research",
  providerId: "unesp",
  institution: "UNESP/Vunesp",
  archiveUrl: "https://www.vunesp.com.br/busca/vestibular/encerrados",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "permission-required",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["first", "second"],
  subjects: ["general"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "unesp-research@0.1.0",
  lastVerifiedAt: "2026-09-08",
  confidence: "baixa",
  notes:
    "Páginas oficiais Vunesp de 2022–2025 foram encontradas, mas o link de " +
    "Provas e Gabaritos redireciona para login da Área do Candidato. Sem fonte " +
    "pública rehostável, não há provider.",
};

/** UFSC pesquisada e bloqueada por somatória/proposições. */
export const ufscResearchSource: ExamSourceDefinition = {
  id: "ufsc-coperve-research",
  providerId: "ufsc",
  institution: "UFSC/Coperve",
  archiveUrl: "https://vestibularunificado2026.ufsc.br/provas-e-gabaritos-definitivos/",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["day1", "day2"],
  subjects: ["general"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: "ufsc-research@0.1.0",
  lastVerifiedAt: "2026-09-08",
  confidence: "baixa",
  notes:
    "Arquivo oficial e gabaritos definitivos existem, mas o formato é de " +
    "proposições/somatória. Não entra no runner A-E nesta wave.",
};

/** UDESC: duas sessões objetivas por edição, mantidas sob um único provider. */
export const udescSource: ExamSourceDefinition = {
  id: "udesc-official-archive",
  providerId: "udesc",
  institution: "UDESC",
  archiveUrl: "https://www.udesc.br/vestibular/provasanteriores",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "university",
  discovery: "manual",
  years: udescYears(),
  phases: ["morning", "afternoon"],
  subjects: ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: UDESC_PARSER,
  lastVerifiedAt: "2026-09-09",
  confidence: "alta",
  notes:
    "Arquivo oficial público cobre 18 edições entre 2015.1 e 2026.2. Matutino e " +
    "vespertino mantêm numeração própria; Inglês é a variante canônica da manhã.",
};

/** ACAFE: arquivo oficial por edição, com prova e gabarito final associados. */
export const acafeSource: ExamSourceDefinition = {
  id: "acafe-official-archive",
  providerId: "acafe",
  institution: "Sistema ACAFE",
  archiveUrl: "https://www.acafe.org.br/",
  sourceType: "pdf-reference",
  statementMode: "reference-only",
  extractionMethod: "pdf-text-layer",
  rightsStatus: "official-reference",
  status: "active",
  family: "university",
  discovery: "manual",
  years: acafeYears(),
  phases: ["single"],
  subjects: ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"],
  answerKeyAvailable: true,
  expectedAnswersAvailable: false,
  parserVersion: ACAFE_PARSER,
  lastVerifiedAt: "2026-09-09",
  confidence: "alta",
  notes:
    "Nove edições entre 2022.2 e 2026.2 têm prova e gabarito oficial associados. " +
    "A edição 2022.1 foi recusada porque o PDF rotulado como oficial diz preliminar.",
};

/** PUC-PR pesquisada sem arquivo público consistente. */
export const pucPrResearchSource: ExamSourceDefinition = {
  id: "puc-pr-research",
  providerId: "puc-pr",
  institution: "PUC-PR",
  archiveUrl: "https://graduacao.pucpr.br/",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "unknown",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["single"],
  subjects: ["general"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "puc-pr-research@0.1.0",
  lastVerifiedAt: "2026-09-08",
  confidence: "baixa",
  notes:
    "PUC-PR não foi agrupada como PUC genérica. Nesta investigação não apareceu " +
    "arquivo oficial público e consistente de prova ↔ gabarito.",
};

/** PUC-Rio pesquisada sem prova própria pública atual. */
export const pucRioResearchSource: ExamSourceDefinition = {
  id: "puc-rio-research",
  providerId: "puc-rio",
  institution: "PUC-Rio",
  archiveUrl: "https://www.puc-rio.br/ensinopesq/ccg/vestibular/",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "unknown",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["single"],
  subjects: ["general"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "puc-rio-research@0.1.0",
  lastVerifiedAt: "2026-09-08",
  confidence: "baixa",
  notes:
    "Tratada como instituição separada. Não foi localizada fonte oficial pública " +
    "com prova objetiva e gabarito final associáveis para ingestão.",
};

/** Mackenzie pesquisado sem archive público fechado. */
export const mackenzieResearchSource: ExamSourceDefinition = {
  id: "mackenzie-research",
  providerId: "mackenzie",
  institution: "Mackenzie",
  archiveUrl: "https://www.mackenzie.br/vestibular",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "unknown",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["single"],
  subjects: ["general"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "mackenzie-research@0.1.0",
  lastVerifiedAt: "2026-09-08",
  confidence: "baixa",
  notes:
    "Página oficial atual investigada, sem arquivo público consistente de provas " +
    "anteriores com gabarito final para parser fail-closed.",
};

/** UFRJ histórica: não assumir prova própria vigente. */
export const ufrjHistoricalResearchSource: ExamSourceDefinition = {
  id: "ufrj-historical-research",
  providerId: "ufrj",
  institution: "UFRJ",
  archiveUrl: "https://acessograduacao.ufrj.br/",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "unknown",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["single"],
  subjects: ["general"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "ufrj-historical-research@0.1.0",
  lastVerifiedAt: "2026-09-08",
  confidence: "baixa",
  notes:
    "Cobertura histórica precisa ser tratada separadamente. Não foi criado " +
    "provider atual porque a investigação não confirmou vestibular próprio vigente " +
    "com arquivo público consistente.",
};

/** UFPR pesquisada, mas deliberadamente não executável nesta wave. */
export const ufprResearchSource: ExamSourceDefinition = {
  id: "ufpr-research",
  providerId: "ufpr",
  institution: "UFPR",
  archiveUrl: "https://lua.nc.ufpr.br/PortalNC/Concurso?concurso=PS2026",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "blocked",
  family: "university",
  discovery: "manual",
  years: [],
  phases: ["first", "second"],
  subjects: ["general"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "ufpr-research@0.1.0",
  lastVerifiedAt: "2026-09-07",
  confidence: "baixa",
  notes:
    "PS 2018–PS 2026 foram investigados. Há provas, versões e documentos " +
    "preliminares/definitivos, mas não foi encontrada uma associação final " +
    "consistente para ingestão segura; não há parser nem provider.",
};

/** EEAR pesquisada e adiada por códigos e cursos múltiplos. */
export const eearResearchSource: ExamSourceDefinition = {
  id: "eear-research",
  providerId: "eear",
  institution: "FAB",
  archiveUrl: "https://ingresso.eear.fab.mil.br/SOO/home/provas_anteriores.php?sigla_conc=%25",
  sourceType: "official-html",
  statementMode: "reference-only",
  extractionMethod: "manual",
  rightsStatus: "official-reference",
  status: "blocked",
  family: "air-force",
  discovery: "automatic",
  years: [],
  phases: ["first"],
  subjects: ["portuguese", "mathematics", "english"],
  answerKeyAvailable: false,
  expectedAnswersAvailable: false,
  parserVersion: "eear-research@0.1.0",
  lastVerifiedAt: "2026-09-07",
  confidence: "baixa",
  notes:
    "O arquivo oficial tem vários cursos, anos, códigos e opções de prova. " +
    "A associação determinística entre cada prova e seu gabarito final não " +
    "foi concluída; provider adiado para v8.5.4.",
};

const SOURCES = new Map<string, ExamSourceDefinition>([
  [enemSource.id, enemSource],
  [itaSource.id, itaSource],
  [imeSource.id, imeSource],
  [enemOfficialSource.id, enemOfficialSource],
  [fuvestSource.id, fuvestSource],
  [afaSource.id, afaSource],
  [epcarSource.id, epcarSource],
  [espcexSource.id, espcexSource],
  [esaSource.id, esaSource],
  [unicampSource.id, unicampSource],
  [uelSource.id, uelSource],
  [pucSpSource.id, pucSpSource],
  [uemResearchSource.id, uemResearchSource],
  [uepgResearchSource.id, uepgResearchSource],
  [unespResearchSource.id, unespResearchSource],
  [ufscResearchSource.id, ufscResearchSource],
  [udescSource.id, udescSource],
  [acafeSource.id, acafeSource],
  [pucPrResearchSource.id, pucPrResearchSource],
  [pucRioResearchSource.id, pucRioResearchSource],
  [mackenzieResearchSource.id, mackenzieResearchSource],
  [ufrjHistoricalResearchSource.id, ufrjHistoricalResearchSource],
  [ufprResearchSource.id, ufprResearchSource],
  [eearResearchSource.id, eearResearchSource],
]);

export function listSources(): ExamSourceDefinition[] {
  return [...SOURCES.values()];
}

export function getSource(id: string): ExamSourceDefinition {
  const s = SOURCES.get(id);
  if (!s) throw new Error(`Fonte não registrada: ${id}`);
  return s;
}

/** Fontes que alimentam um provider. */
export function sourcesForProvider(providerId: string): ExamSourceDefinition[] {
  return listSources().filter((s) => s.providerId === providerId);
}

function provenance(src: ExamSourceDefinition, documentUrl: string, page?: number): Provenance {
  return {
    providerId: src.providerId,
    sourceId: src.id,
    institution: src.institution,
    official: src.rightsStatus !== "unknown",
    documentUrl,
    page,
    parserVersion: src.parserVersion,
    lastVerifiedAt: src.lastVerifiedAt,
  };
}

export const itaImporter: ExamImporter = {
  sourceId: itaSource.id,
  availableYears: () => itaYears(),
  provenanceFor(year, phase = "first", page) {
    // A 2ª fase é dividida por matéria; sem matéria, aponta o arquivo do ano.
    const url =
      phase === "second"
        ? (itaSecondPhaseUrls(year)[0]?.url ?? itaFirstPhaseUrl(year))
        : itaFirstPhaseUrl(year);
    return provenance(itaSource, url, page);
  },
};

export const enemImporter: ExamImporter = {
  sourceId: enemSource.id,
  availableYears: () => examYears(),
  provenanceFor(year) {
    return provenance(enemSource, `${enemSource.archiveUrl}/v1/exams/${year}/questions`);
  },
};

export const imeImporter: ExamImporter = {
  sourceId: imeSource.id,
  availableYears: () => imeYears(),
  provenanceFor(year, phase = "first", page) {
    const edicao = imeEditionOfYear(year);
    // Sem edição conhecida, a procedência aponta o arquivo da instituição —
    // nunca uma URL montada por padrão, que daria 404 ou o documento errado.
    const url =
      (edicao && (phase === "first" ? imeExamUrl(edicao) : imeAnswerKeyUrl(edicao))) ??
      imeSource.archiveUrl;
    return provenance(imeSource, url, page);
  },
};

export const fuvestImporter: ExamImporter = {
  sourceId: fuvestSource.id,
  availableYears: () => fuvestYears(),
  provenanceFor(year, phase = "first", page) {
    const url =
      (phase === "first" ? fuvestExamUrl(year) : fuvestSecondPhaseUrls(year)[0]) ??
      fuvestSource.archiveUrl;
    return provenance(fuvestSource, url, page);
  },
};

export const afaImporter: ExamImporter = {
  sourceId: afaSource.id,
  availableYears: () => afaYears(),
  provenanceFor(year, phase = "first", page) {
    const key = afaAnswerKey(year);
    const url = phase === "first" ? key?.examUrl ?? key?.answerKeyUrl : afaSource.archiveUrl;
    return provenance(afaSource, url ?? afaSource.archiveUrl, page);
  },
};

export const epcarImporter: ExamImporter = {
  sourceId: epcarSource.id,
  availableYears: () => epcarYears(),
  provenanceFor(year, phase = "first", page) {
    const key = epcarAnswerKey(year);
    const url = phase === "first" ? key?.examUrl ?? key?.answerKeyUrl : epcarSource.archiveUrl;
    return provenance(epcarSource, url ?? epcarSource.archiveUrl, page);
  },
};

export const espcexImporter: ExamImporter = {
  sourceId: espcexSource.id,
  availableYears: () => espcexYears(),
  provenanceFor(year, phase = "day1", page) {
    const selectedPhase = phase === "day2" ? "day2" : "day1";
    const url = espcexExamUrl(year, selectedPhase) ?? espcexSource.archiveUrl;
    return provenance(espcexSource, url, page);
  },
};

export const esaImporter: ExamImporter = {
  sourceId: esaSource.id,
  availableYears: () => esaYears(),
  provenanceFor(year, phase = "single", page) {
    const url = phase === "single" ? esaExamUrl(year) : null;
    return { ...provenance(esaSource, url ?? esaSource.archiveUrl, page), official: false };
  },
};

export const unicampImporter: ExamImporter = {
  sourceId: unicampSource.id,
  availableYears: () => unicampYears(),
  provenanceFor(year, phase = "first", page) {
    const url = phase === "first" ? unicampExamUrl(year) : unicampSource.archiveUrl;
    return provenance(unicampSource, url ?? unicampSource.archiveUrl, page);
  },
};

export const uelImporter: ExamImporter = {
  sourceId: uelSource.id,
  availableYears: () => uelYears(),
  provenanceFor(year, phase = "first", page) {
    const url = phase === "first" ? uelExamUrl(year) : uelSource.archiveUrl;
    return provenance(uelSource, url ?? uelSource.archiveUrl, page);
  },
};

export const pucSpImporter: ExamImporter = {
  sourceId: pucSpSource.id,
  availableYears: () => pucSpYears(),
  provenanceFor(year, phase = "single", page) {
    const url = phase === "single" ? pucSpExamUrl(year) : pucSpSource.archiveUrl;
    return provenance(pucSpSource, url ?? pucSpSource.archiveUrl, page);
  },
};

export const udescImporter: ExamImporter = {
  sourceId: udescSource.id,
  availableYears: () => udescYears(),
  provenanceFor(year, phase = "morning", page) {
    const edition = udescEditions().find((candidate) => candidate.year === year);
    const session = phase === "afternoon" ? "afternoon" : "morning";
    const url = edition ? udescExamUrl(edition.id, session) : null;
    return provenance(udescSource, url ?? udescSource.archiveUrl, page);
  },
};

export const acafeImporter: ExamImporter = {
  sourceId: acafeSource.id,
  availableYears: () => acafeYears(),
  provenanceFor(year, phase = "single", page) {
    const edition = acafeEditions().find((candidate) => candidate.year === year);
    const url = phase === "single" && edition ? acafeExamUrl(edition.id) : null;
    return provenance(acafeSource, url ?? acafeSource.archiveUrl, page);
  },
};

export function importerForProvider(providerId: string): ExamImporter | null {
  if (providerId === "ita") return itaImporter;
  if (providerId === "enem") return enemImporter;
  if (providerId === "ime") return imeImporter;
  if (providerId === "fuvest") return fuvestImporter;
  if (providerId === "afa") return afaImporter;
  if (providerId === "epcar") return epcarImporter;
  if (providerId === "espcex") return espcexImporter;
  if (providerId === "esa") return esaImporter;
  if (providerId === "unicamp") return unicampImporter;
  if (providerId === "uel") return uelImporter;
  if (providerId === "puc-sp") return pucSpImporter;
  if (providerId === "udesc") return udescImporter;
  if (providerId === "acafe") return acafeImporter;
  return null;
}
