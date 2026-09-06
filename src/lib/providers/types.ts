// Contratos genéricos de provas. O ENEM é apenas o primeiro provider;
// nada aqui pode assumir ENEM implicitamente.

/**
 * Fase da aplicação. O ENEM aplica em dois dias; o ITA divide em duas fases
 * (objetiva e discursiva). Os dois vocabulários convivem porque descrevem
 * coisas diferentes — traduzir um no outro perderia significado.
 */
export type ExamPhase = "day1" | "day2" | "single" | "first" | "second";

/** Natureza da resposta esperada. */
export type QuestionType = "multiple_choice" | "discursive" | "essay";

/**
 * Procedência oficial. Quando o enunciado não pode ser reproduzido (prova
 * digitalizada, conteúdo com direitos do organizador), é por aqui que o app
 * leva o aluno ao documento original em vez de inventar o texto.
 */
export interface OfficialSource {
  official: boolean;
  institution: string;
  documentUrl: string;
  page?: number;
}

/** Disciplina normalizada, sempre ligada a uma grande área do provider. */
export interface ExamSubject {
  id: string;
  label: string;
  area: string;
}

/** Origem citada pela questão (texto de apoio, imagem, etc.). */
export interface ExamSource {
  label: string;
  url?: string;
}

/** Alternativa normalizada. */
export interface NormalizedAlternative {
  letter: string;
  text: string | null;
  file: string | null;
  isCorrect: boolean;
}

export interface NormalizedClassification {
  primary: string;
  tags: string[];
  path: string[];
  subtopic: string | null;
  confidence: "alta" | "media" | "baixa";
  score: number;
}

export interface NormalizedQuestionQuality {
  score: number;
  status: "healthy" | "review" | "blocked";
  scoreable: boolean;
  issueCodes: string[];
}

/**
 * Questão normalizada: a forma que a aplicação consome, independente do
 * formato bruto de cada provider.
 */
export interface NormalizedQuestion {
  providerId: string;
  examId: string;
  year: number;
  index: number;
  phase: ExamPhase;
  language: string | null;
  subject: ExamSubject;
  /** Conteúdo classificado (taxonomia do provider). */
  content: string;
  classification?: NormalizedClassification;
  quality?: NormalizedQuestionQuality;
  context: string | null;
  alternativesIntroduction: string | null;
  alternatives: NormalizedAlternative[];
  correctAlternative: string | null;
  files: string[];
  sources: ExamSource[];

  // ---- Campos da v8. Opcionais: o ENEM continua exatamente como estava. ----
  /** Numeração oficial dentro da prova, quando difere do índice interno. */
  number?: number;
  type?: QuestionType;
  /** Documento oficial de origem. */
  official?: OfficialSource;
  /**
   * false quando o enunciado não está disponível em texto e o aluno precisa
   * lê-lo no documento oficial. A UI deve deixar isso explícito em vez de
   * mostrar uma questão vazia.
   */
  statementAvailable?: boolean;
  /** Resposta de referência de questão discursiva, quando o órgão publica. */
  expectedAnswer?: string | null;
}

/** Descrição estática de uma prova suportada. */
export interface ExamMetadata {
  id: string;
  label: string;
  shortLabel: string;
  /** Anos disponíveis, do mais recente ao mais antigo. */
  years: number[];
  /** Idiomas de prova estrangeira, quando houver. */
  languages: { id: string; label: string }[];
  phases: ExamPhase[];
  hasEssay: boolean;
  /** Grandes áreas, na ordem de exibição. */
  areas: { id: string; label: string }[];
}

export interface FetchQuestionsParams {
  year: number;
  language?: string | null;
  force?: boolean;
}

/** Um provider de prova plugável. */
export interface ExamProvider {
  readonly id: string;
  readonly metadata: ExamMetadata;
  /** Busca e normaliza as questões de um ano. */
  fetchQuestions(params: FetchQuestionsParams): Promise<NormalizedQuestion[]>;
  /** Chave estável de uma questão dentro do provider. */
  questionKey(q: NormalizedQuestion): string;
}
