import type {
  AIAssistanceLevel,
  AIAssistanceMode,
  AIGeneratedQuestion,
  AIPedagogicalPolicy,
  AIQuestionContext,
  AIRequest,
  AIResponse,
} from "./types";

const FULL_SOLUTION_PATTERNS = [
  /resolu[cç][aã]o completa/i,
  /resolva (?:essa|esta|a) quest[aã]o/i,
  /resolva completamente/i,
  /qual (?:é|e) (?:a )?resposta correta/i,
  /qual (?:é|e) (?:o )?gabarito/i,
  /me d[êe] a resposta/i,
];

const DEFAULT_LEVELS: Record<AIAssistanceMode, AIAssistanceLevel> = {
  hint: 1,
  explain: 4,
  "guided-solve": 5,
  "why-wrong": 4,
  "explain-alternative": 4,
  "study-needed": 2,
  "similar-question": 4,
  chat: 2,
};

function clampLevel(level: number): AIAssistanceLevel {
  return Math.max(1, Math.min(6, Math.round(level))) as AIAssistanceLevel;
}

export function isExplicitFullSolutionRequest(message?: string): boolean {
  if (!message) return false;
  return FULL_SOLUTION_PATTERNS.some((pattern) => pattern.test(message));
}

export function buildPedagogicalPolicy(request: AIRequest): AIPedagogicalPolicy {
  const explicitFullSolution =
    request.mode === "chat" && isExplicitFullSolutionRequest(request.message);
  const requested = request.requestedLevel
    ? clampLevel(request.requestedLevel)
    : DEFAULT_LEVELS[request.mode];
  const level = explicitFullSolution ? 6 : requested;
  const revealAnswer = explicitFullSolution || level === 6;

  const objectives: Record<AIAssistanceMode, string> = {
    hint: "Dar uma pista pequena que destrave o raciocínio sem entregar a alternativa correta.",
    explain: "Explicar os conceitos e a lógica necessária para resolver a questão sem transformar a resposta em gabarito imediato.",
    "guided-solve": "Conduzir o aluno pelo próximo passo e pela sequência de raciocínio, preservando participação ativa.",
    "why-wrong": "Explicar o problema da alternativa marcada e o critério que o aluno deve rever, sem revelar a letra correta salvo pedido explícito.",
    "explain-alternative": "Explicar por que a alternativa indicada faz ou não faz sentido no contexto da questão.",
    "study-needed": "Identificar os pré-requisitos e conteúdos que o aluno precisa dominar para resolver questões desse tipo.",
    "similar-question": "Criar prática semelhante claramente identificada como gerada por IA e nunca como questão oficial.",
    chat: "Responder como tutor contextual, usando a questão e o histórico do aluno quando forem relevantes.",
  };

  return {
    mode: request.mode,
    level,
    revealAnswer,
    includeCorrectAnswerInModelContext:
      revealAnswer || request.mode === "why-wrong" || request.mode === "explain-alternative",
    objective: objectives[request.mode],
  };
}

export function questionContextForModel(
  question: AIQuestionContext,
  policy: AIPedagogicalPolicy,
): AIQuestionContext {
  if (policy.includeCorrectAnswerInModelContext) return question;
  return { ...question, correctAnswer: undefined };
}

export function buildTutorPrompts(
  request: AIRequest,
  policy: AIPedagogicalPolicy,
): { systemPrompt: string; userPrompt: string } {
  const question = questionContextForModel(request.question, policy);
  const systemPrompt = [
    "Você é o tutor pedagógico do ENEMLab.",
    "Seu objetivo é ensinar, não apenas entregar respostas.",
    `Nível de assistência atual: ${policy.level}/6.`,
    `Objetivo desta interação: ${policy.objective}`,
    policy.revealAnswer
      ? "O aluno pediu assistência de nível 6; a resposta correta pode ser revelada."
      : "Não revele a letra da alternativa correta nem escreva um gabarito explícito.",
    "Nunca invente instituição, ano, prova, número ou fonte oficial.",
    "Se houver questão gerada, identifique-a obrigatoriamente como 'Questão gerada por IA — estilo ENEM'.",
    "Use linguagem clara, progressiva e adequada ao ensino médio.",
    "Retorne somente JSON válido com as chaves: title, explanation, concepts, nextStep, revealAnswer, answer, diagnostic, generatedQuestion.",
    "concepts deve ser um array curto de strings. diagnostic é opcional.",
    request.mode === "similar-question"
      ? "Para similar-question, generatedQuestion é obrigatório e deve conter statement, alternatives e correctAnswer sem atribuir instituição, ano, prova, número ou fonte oficial."
      : "generatedQuestion só deve ser usado no modo similar-question.",
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      mode: request.mode,
      message: request.message || null,
      selectedAlternative:
        request.selectedAlternative || request.question.selectedAnswer || null,
      question,
      student: request.student || null,
      conversation: (request.conversation || []).slice(-8),
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}

export function normalizeGeneratedQuestion(
  generated?: Partial<AIGeneratedQuestion>,
): AIGeneratedQuestion | undefined {
  if (!generated?.statement || !generated.alternatives?.length || !generated.correctAnswer) {
    return undefined;
  }
  return {
    origin: "ai-generated",
    label: "Questão gerada por IA — estilo ENEM",
    style: "ENEM",
    statement: String(generated.statement),
    alternatives: generated.alternatives
      .filter((alternative) => alternative?.letter && alternative?.text)
      .slice(0, 5)
      .map((alternative) => ({
        letter: String(alternative.letter),
        text: String(alternative.text),
      })),
    correctAnswer: String(generated.correctAnswer),
    explanation: generated.explanation ? String(generated.explanation) : undefined,
  };
}

export function enforcePedagogicalResponse(
  raw: Partial<AIResponse>,
  request: AIRequest,
  policy: AIPedagogicalPolicy,
  provider: string,
): AIResponse {
  const revealAnswer = policy.revealAnswer && raw.revealAnswer !== false;
  const concepts = Array.isArray(raw.concepts)
    ? raw.concepts.map(String).filter(Boolean).slice(0, 6)
    : [];

  return {
    mode: request.mode,
    level: policy.level,
    title: String(raw.title || "Tutor ENEMLab"),
    explanation: String(raw.explanation || "Não foi possível gerar uma explicação útil."),
    concepts,
    nextStep: String(raw.nextStep || "Tente aplicar o conceito ao enunciado antes de avançar."),
    revealAnswer,
    answer: revealAnswer && raw.answer ? String(raw.answer) : undefined,
    diagnostic: raw.diagnostic,
    generatedQuestion:
      request.mode === "similar-question"
        ? normalizeGeneratedQuestion(raw.generatedQuestion)
        : undefined,
    provider,
  };
}
