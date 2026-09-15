// Domínio ENEM Lab — modelo de dados tipado (portado do v6, unificado).

export type AreaId =
  | "matematica"
  | "ciencias-natureza"
  | "ciencias-humanas"
  | "linguagens";

export type Language = "ingles" | "espanhol";

export type Confidence = "certeza" | "duvida" | "chute";
export type Difficulty = "facil" | "media" | "dificil";
export type KnewChoice = "sabia" | "quase" | "nao" | "pressa" | "";

export type AttemptMode =
  | "sprint15"
  | "sprint30"
  | "area"
  | "adaptive15"
  | "unseen15"
  | "unseen30"
  | "unseen90"
  | "full"
  | "real1"
  | "real2"
  | "retry"
  | "srs"
  | "srs-recall"
  | "content"
  | "bank"
  | "adaptive";

export type StudyObjectiveId = "balanced" | "recovery" | "coverage" | "exam" | "gain";
export type StudyFeedbackValue = "helpful" | "neutral" | "not_helpful";
export type StudySignalId =
  | "weakness"
  | "sample"
  | "overdueReview"
  | "novelty"
  | "spacing"
  | "difficulty";

export interface StudyFeedback {
  usefulness: StudyFeedbackValue;
  at: string;
}

export interface StudyDecisionRecord {
  id: string;
  attemptId?: string;
  providerId: string;
  at: string;
  objective: StudyObjectiveId;
  questionKeys: string[];
  topContent?: string | null;
  topReasons: string[];
  dominantSignal?: StudySignalId | null;
  readinessBefore?: number | null;
  readinessAfter?: number | null;
  accuracyAfter?: number | null;
  feedback?: StudyFeedback;
  experimentId?: string | null;
  experimentVariant?: string | null;
}

export interface StudyExperimentRecord {
  id: string;
  experimentId: string;
  variant: string;
  providerId: string;
  decisionId: string;
  at: string;
  completedAt?: string | null;
  readinessDelta?: number | null;
  accuracy?: number | null;
  feedback?: StudyFeedbackValue | null;
}

export interface StudyProviderConfig {
  objective?: StudyObjectiveId;
  targetDate?: string | null;
  weeklyQuestions?: number | null;
  targetCoverage?: number | null;
  targetReadiness?: number | null;
}

export interface StudyIntelligenceState {
  decisions: Record<string, StudyDecisionRecord>;
  experiments: Record<string, StudyExperimentRecord>;
  providerConfig: Record<string, StudyProviderConfig>;
}

// ---- Questões vindas da API enem.dev ----
export interface Alternative {
  letter: string;
  text: string;
  file?: string | null;
  isCorrect?: boolean;
}

/**
 * Snapshot efêmero da classificação feita sobre o conteúdo do provider antes
 * de um overlay visual esconder o texto. Não é persistido em Attempt/DB.
 */
export interface QuestionClassificationSnapshot {
  primary: string;
  tags: string[];
  path: string[];
  subtopic: string | null;
  confidence: "alta" | "media" | "baixa";
  score: number;
  margin: number;
  evidence: string[];
}

export interface Question {
  providerId?: string;
  examId?: string;
  editionId?: string;
  index: number;
  year: number;
  phase?: string;
  language?: string | null;
  discipline?: string | { value?: string; label?: string };
  context?: string;
  alternativesIntroduction?: string;
  alternatives?: Alternative[];
  correctAlternative?: string;
  files?: string[];
  /** Classificação preservada quando um overlay visual remove o texto visível. */
  classificationSnapshot?: QuestionClassificationSnapshot;

  // ---- v8: provas em modo referência (enunciado na fonte oficial) ----
  /** Numeração oficial na prova, quando difere do índice. */
  number?: number;
  /**
   * false quando o enunciado não está disponível em texto e precisa ser lido
   * no documento oficial. A UI mostra a referência em vez de questão vazia.
   */
  statementAvailable?: boolean;
  official?: {
    official: boolean;
    institution: string;
    documentUrl: string;
    page?: number;
  };
}

export interface QuestionRef {
  index: number;
  year?: number;
  language?: string | null;
  discipline: string;
  /** Ausente nos dados anteriores à v8: resolve para ENEM na leitura. */
  providerId?: string;
  /** Identidade exata para provas com múltiplas edições/sessões no mesmo ano. */
  questionKey?: string;
  editionId?: string;
  phase?: string;
  examId?: string;
}

// ---- Correção ----
export interface ResultRow {
  key: string;
  /** Ausente nos dados anteriores a v8: resolve para ENEM na leitura. */
  providerId?: string;
  index: number;
  year: number;
  area: string;
  language: string | null;
  content: string;
  tags?: string[];
  selected: string | null;
  correct: string | null;
  isCorrect: boolean | null;
  confidence: Confidence | null;
  timeSec: number;
  flagged: boolean;
  finishedAt: string | null;
  difficulty?: Difficulty;
  pass?: number;
  attemptId?: string;
}

export interface AttemptResult {
  rows: ResultRow[];
  correct: number;
  total: number;
  blank: number;
}

export interface Essay {
  theme: string;
  text: string;
  versions?: { at: string; text: string }[];
}

export interface DailyPlanStamp {
  source: "daily-plan";
  dateKey: string;
  blockId: string;
}

export interface Attempt {
  id: string;
  /** Prova de origem. Ausente nos dados antigos: resolve para ENEM. */
  providerId?: string;
  year: number;
  lang: Language;
  mode: AttemptMode;
  area: AreaId | "all";
  minutes: number;
  strict: boolean;
  strategy?: boolean;
  alerts?: boolean;
  pass?: number;
  passByQuestion?: Record<string, number>;
  realDay?: 1 | 2 | null;
  activeRecall?: boolean;
  revealedRecall?: boolean;
  retryOf?: string;
  plan?: DailyPlanStamp;
  questionRefs: QuestionRef[];
  answers: Record<string, string>;
  confidence: Record<string, Confidence>;
  flags: Record<string, boolean>;
  timeQ: Record<string, number>;
  elapsed: number;
  questionSec?: number;
  essaySec?: number;
  startedAt: string;
  finishedAt: string | null;
  result: AttemptResult | null;
  essay?: Essay | null;
  sessionId?: string;
}

export interface SrsEntry {
  reps: number;
  providerId?: string;
  interval: number;
  due: string;
  year: number;
  index: number;
  area: string;
  content?: string;
  language?: string | null;
  discipline?: string;
  lastResult?: "correct" | "wrong";
}

export interface Note {
  reason?: string;
  tag?: string;
  tags?: string;
  text?: string;
  knew?: KnewChoice;
}

export interface Goals {
  questions: number;
  essays: number;
  reviews: number;
}

export interface StudySession {
  id: string;
  startedAt: string;
  lastAt: string;
  attemptIds: string[];
  questions: number;
  correct: number;
  total: number;
  reviews: number;
  essays: number;
  contents: Record<string, number>;
}

// ---- Estado persistido (o "db" do v6) ----
export interface DB {
  v: 6;
  schema: number;
  build: string;
  theme: "light" | "dark";
  attempts: Attempt[];
  notes: Record<string, Note>;
  srs: Record<string, SrsEntry>;
  sessions: StudySession[];
  goals: Goals;
  /** Estado opcional e retrocompatível do motor de inteligência local. */
  studyIntelligence?: StudyIntelligenceState;
  /** Prova ativa na interface. Ausente = ENEM, como sempre foi. */
  activeProvider?: string;
  lastOpened: string | null;
  lastBackupAt: string | null;
  migratedFrom?: string;
}
