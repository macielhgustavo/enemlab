import type {
  AIAssistanceLevel,
  AIAssistanceMode,
  AIDiagnosticSignal,
  AIGeneratedQuestion,
  AIGeneratedQuestionDraft,
  AIGeneratedQuestionLabel,
  AIPedagogicalPolicy,
  AIProviderOutput,
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

export function generatedQuestionIdentity(question: AIQuestionContext): {
  style: string;
  label: AIGeneratedQuestionLabel;
} {
  const style =
    question.origin.kind === "official"
      ? question.origin.institution
      : question.origin.style;
  return {
    style,
    label: `Questão gerada por IA — estilo ${style}`,
  };
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
  const generatedIdentity = generatedQuestionIdentity(request.question);
  const systemPrompt = [
    "Você é o tutor pedagógico do ENEMLab.",
    "Seu objetivo é ensinar, não apenas entregar respostas.",
    `Nível de assistência atual: ${policy.level}/6.`,
    `Objetivo desta interação: ${policy.objective}`,
    policy.revealAnswer
      ? "O aluno pediu assistência de nível 6; a resposta correta pode ser revelada."
      : "Não revele a letra da alternativa correta nem escreva um gabarito explícito.",
    "Quando o histórico trouxer métricas de independência, trate accuracy como desempenho bruto e independentAccuracy como evidência obtida sem assistência alta.",
    "Nunca diga que a IA causou um acerto. Prefira formulações como 'acerto em questão com assistência alta'. Não altere nem reinterprete a nota oficial do aluno.",
    "Se currentQuestionAssistance indicar ajuda alta ou gabarito revelado, não trate a questão atual como evidência independente de domínio.",
    "Nunca invente instituição, ano, prova, número ou fonte oficial.",
    `Se houver questão gerada, ela será identificada pelo produto como '${generatedIdentity.label}'. Não inclua instituição, ano, prova, número, fonte, origin, label ou style dentro de generatedQuestion.`,
    "Se a resolução depender de uma imagem que você não consegue interpretar a partir do contexto recebido, diga essa limitação em vez de inventar detalhes.",
    "Use linguagem clara, progressiva e adequada ao ensino médio.",
    "Retorne somente um objeto JSON válido. Não use Markdown fora do JSON.",
    "As chaves obrigatórias são: title, explanation, concepts, nextStep, revealAnswer.",
    "answer, diagnostic e generatedQuestion são opcionais. concepts deve ser um array curto de strings.",
    "diagnostic, quando usado, deve conter category, confidence e note. category deve ser content-gap, interpretation, calculation, strategy, attention ou unknown; confidence deve ser low, medium ou high.",
    "Só use diagnostic quando estiver analisando uma alternativa efetivamente marcada pelo aluno. Não diagnostique a partir de uma simples pista, explicação geral ou falta de histórico.",
    "Use confidence=high somente quando a alternativa marcada e o contexto da questão sustentarem claramente a categoria. Se houver ambiguidade, use medium/low; se não for possível inferir, use category=unknown.",
    request.mode === "similar-question"
      ? "Para similar-question, generatedQuestion é obrigatório e deve conter somente statement, alternatives, correctAnswer e explanation opcional."
      : "Não use generatedQuestion fora do modo similar-question.",
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
  generated: AIGeneratedQuestionDraft | undefined,
  sourceQuestion: AIQuestionContext,
): AIGeneratedQuestion | undefined {
  if (!generated?.statement || !generated.alternatives?.length || !generated.correctAnswer) {
    return undefined;
  }
  const identity = generatedQuestionIdentity(sourceQuestion);
  return {
    origin: "ai-generated",
    label: identity.label,
    style: identity.style,
    statement: generated.statement,
    alternatives: generated.alternatives.slice(0, 5).map((alternative) => ({
      letter: alternative.letter,
      text: alternative.text,
      file: alternative.file || null,
    })),
    correctAnswer: generated.correctAnswer,
    explanation: generated.explanation,
  };
}

function diagnosticForResponse(
  raw: AIProviderOutput,
  request: AIRequest,
): AIDiagnosticSignal | undefined {
  const hasSelectedAlternative = !!(
    request.selectedAlternative || request.question.selectedAnswer
  );
  const evidenceBearingMode =
    request.mode === "why-wrong" || request.mode === "explain-alternative";
  if (!hasSelectedAlternative || !evidenceBearingMode) return undefined;
  return raw.diagnostic;
}

export function enforcePedagogicalResponse(
  raw: AIProviderOutput,
  request: AIRequest,
  policy: AIPedagogicalPolicy,
  provider: string,
): AIResponse {
  const revealAnswer = policy.revealAnswer && raw.revealAnswer !== false;

  return {
    mode: request.mode,
    level: policy.level,
    title: raw.title || "Tutor ENEMLab",
    explanation: raw.explanation || "Não foi possível gerar uma explicação útil.",
    concepts: raw.concepts.filter(Boolean).slice(0, 6),
    nextStep: raw.nextStep || "Tente aplicar o conceito ao enunciado antes de avançar.",
    revealAnswer,
    answer: revealAnswer && raw.answer ? raw.answer : undefined,
    diagnostic: diagnosticForResponse(raw, request),
    generatedQuestion:
      request.mode === "similar-question"
        ? normalizeGeneratedQuestion(raw.generatedQuestion, request.question)
        : undefined,
    provider,
  };
}
