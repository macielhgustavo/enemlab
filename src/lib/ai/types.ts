export type AIAssistanceMode =
  | "hint"
  | "explain"
  | "guided-solve"
  | "why-wrong"
  | "explain-alternative"
  | "study-needed"
  | "similar-question"
  | "chat";

export type AIAssistanceLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type AIGeneratedQuestionLabel = `Questão gerada por IA — estilo ${string}`;

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

export interface AIStudentSnapshot {
  completedAttempts: number;
  recentQuestions: number;
  recentAccuracy: number | null;
  topicQuestions: number;
  topicAccuracy: number | null;
  subjectQuestions: number;
  subjectAccuracy: number | null;
  highConfidenceErrors: number;
  weakTopics: Array<{
    topic: string;
    accuracy: number;
    questions: number;
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
  category:
    | "content-gap"
    | "interpretation"
    | "calculation"
    | "strategy"
    | "attention"
    | "unknown";
  confidence: "low" | "medium" | "high";
  note: string;
}

export interface AIGeneratedQuestion {
  origin: "ai-generated";
  label: AIGeneratedQuestionLabel;
  style: string;
  statement: string;
  alternatives: AIQuestionAlternative[];
  correctAnswer: string;
  explanation?: string;
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
  generatedQuestion?: AIGeneratedQuestion;
  provider: string;
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
  generate(request: AIProviderRequest): Promise<AIResponse>;
}
