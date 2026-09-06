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

// ---- Questões vindas da API enem.dev ----
export interface Alternative {
  letter: string;
  text: string;
  file?: string | null;
  isCorrect?: boolean;
}

export interface Question {
  index: number;
  year: number;
  language?: string | null;
  discipline?: string | { value?: string; label?: string };
  context?: string;
  alternativesIntroduction?: string;
  alternatives?: Alternative[];
  correctAlternative?: string;
  files?: string[];
}

export interface QuestionRef {
  index: number;
  year?: number;
  language?: string | null;
  discipline: string;
  /** Ausente nos dados anteriores à v8: resolve para ENEM na leitura. */
  providerId?: string;
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
  lastOpened: string | null;
  lastBackupAt: string | null;
  migratedFrom?: string;
}
