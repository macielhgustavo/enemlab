import type {
  StudentAIAssistanceLevel,
  StudentAIAssistanceMode,
  StudentAIDiagnosticCategory,
  StudentAIDiagnosticConfidence,
} from "../domain/types";

export type AIAssistanceMode = StudentAIAssistanceMode;
export type AIAssistanceLevel = StudentAIAssistanceLevel;
export type AIGeneratedQuestionLabel = `Questão gerada por IA — estilo ${string}`;
export type AISemanticHighlightRole =
  | "objective"
  | "condition"
  | "data"
  | "concept"
  | "trap"
  | "signal";

export interface AISemanticHighlight {
  /** Trecho literal do enunciado ou da introdução das alternativas. */
  text: string;
  role: AISemanticHighlightRole;
  /** Explicação curta da função pedagógica daquele trecho. */
  note: string;
}

export interface AIQuestionAlternative {
  letter: string;
  text: string;
  file?: string | null;
}

export type AIQuestionOrigin =
  | {
      kind: "official";
      providerId: string;
      institution: string;
      year: number;
      questionNumber: number;
      sourceUrl?: string;
    }
  | {
      kind: "ai-generated";
      label: AIGeneratedQuestionLabel;
      style: string;
    };

export interface AIQuestionContext {
  key: string;
  origin: AIQuestionOrigin;
  statement: string;
  alternativesIntroduction?: string;
  alternatives: AIQuestionAlternative[];
  images?: string[];
  correctAnswer?: string | null;
  selectedAnswer?: string | null;
  subject: string;
  topic: string;
  difficulty?: "facil" | "media" | "dificil";
  language?: string | null;
}

export interface AIIndependenceSnapshot {
  independentQuestions: number;
  independentAccuracy: number | null;
  highAssistanceQuestions: number;
  correctWithHighAssistance: number;
  correctWithHighAssistanceShare: number | null;
}

export interface AICurrentQuestionAssistance {
  requests: number;
  maxLevel: AIAssistanceLevel;
  answerRevealed: boolean;
  highAssistance: boolean;
}

export interface AIStudentSnapshot {
  completedAttempts: number;
  recentQuestions: number;
  recentAccuracy: number | null;
  recentIndependence: AIIndependenceSnapshot;
  topicQuestions: number;
  topicAccuracy: number | null;
  topicIndependence: AIIndependenceSnapshot;
  subjectQuestions: number;
  subjectAccuracy: number | null;
  subjectIndependence: AIIndependenceSnapshot;
  currentQuestionAssistance: AICurrentQuestionAssistance | null;
  highConfidenceErrors: number;
  weakTopics: Array<{
    topic: string;
    accuracy: number;
    questions: number;
    independentAccuracy: number | null;
    highAssistanceQuestions: number;
    correctWithHighAssistance: number;
  }>;
}

export interface AIConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AIRequest {
  mode: AIAssistanceMode;
  question: AIQuestionContext;
  student?: AIStudentSnapshot;
  message?: string;
  selectedAlternative?: string | null;
  requestedLevel?: AIAssistanceLevel;
  conversation?: AIConversationTurn[];
}

export interface AIDiagnosticSignal {
  category: StudentAIDiagnosticCategory;
  confidence: StudentAIDiagnosticConfidence;
  note: string;
}

/**
 * Forma que um LLM pode sugerir. Não contém procedência oficial por design:
 * instituição, ano, prova e número nunca podem nascer do provider de IA.
 */
export interface AIGeneratedQuestionDraft {
  statement: string;
  alternatives: AIQuestionAlternative[];
  correctAnswer: string;
  explanation?: string;
}

export interface AIGeneratedQuestion extends AIGeneratedQuestionDraft {
  origin: "ai-generated";
  label: AIGeneratedQuestionLabel;
  style: string;
}

/**
 * Contrato cru de saída do provider. mode, level, provider e procedência são
 * decisões do ENEMLab e, portanto, não são aceitas do modelo.
 */
export interface AIProviderOutput {
  title: string;
  explanation: string;
  concepts: string[];
  nextStep: string;
  revealAnswer: boolean;
  answer?: string;
  diagnostic?: AIDiagnosticSignal;
  highlights?: AISemanticHighlight[];
  generatedQuestion?: AIGeneratedQuestionDraft;
}

export interface AIResponse {
  mode: AIAssistanceMode;
  level: AIAssistanceLevel;
  title: string;
  explanation: string;
  concepts: string[];
  nextStep: string;
  revealAnswer: boolean;
  answer?: string;
  diagnostic?: AIDiagnosticSignal;
  highlights?: AISemanticHighlight[];
  generatedQuestion?: AIGeneratedQuestion;
  provider: string;
  /** Provider que falhou antes de um fallback explícito para o mock. */
  fallbackFrom?: string;
}

export interface AIPedagogicalPolicy {
  mode: AIAssistanceMode;
  level: AIAssistanceLevel;
  revealAnswer: boolean;
  includeCorrectAnswerInModelContext: boolean;
  objective: string;
}

export interface AIProviderRequest {
  request: AIRequest;
  policy: AIPedagogicalPolicy;
  systemPrompt: string;
  userPrompt: string;
}

export interface AIProvider {
  readonly id: string;
  generate(request: AIProviderRequest): Promise<AIProviderOutput>;
}
