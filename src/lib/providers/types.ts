// Contratos genéricos de provas. O ENEM é apenas o primeiro provider;
// nada aqui pode assumir ENEM implicitamente.

/** Fase da aplicação (ENEM tem dois dias; outras provas podem ter uma só). */
export type ExamPhase = "day1" | "day2" | "single";

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
  context: string | null;
  alternativesIntroduction: string | null;
  alternatives: NormalizedAlternative[];
  correctAlternative: string | null;
  files: string[];
  sources: ExamSource[];
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
