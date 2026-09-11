import { describe, expect, it } from "vitest";
import { hasAnswerLeak } from "./leakage";
import { runStudentAI } from "./service";
import type {
  AIProvider,
  AIProviderOutput,
  AIQuestionContext,
  AIRequest,
} from "./types";

const question: AIQuestionContext = {
  key: "offline-eval-percentual",
  origin: {
    kind: "ai-generated",
    label: "Questão gerada por IA — estilo avaliação",
    style: "avaliação",
  },
  statement:
    "O preço de um produto era 100 reais e passou a 120 reais após um reajuste.",
  alternativesIntroduction: "O percentual de reajuste foi de",
  alternatives: [
    { letter: "A", text: "5%" },
    { letter: "B", text: "10%" },
    { letter: "C", text: "20%" },
    { letter: "D", text: "25%" },
    { letter: "E", text: "30%" },
  ],
  correctAnswer: "C",
  selectedAnswer: "A",
  subject: "Matemática",
  topic: "Porcentagem",
};

function request(mode: AIRequest["mode"] = "hint"): AIRequest {
  return {
    mode,
    question,
    selectedAlternative: mode === "why-wrong" ? "A" : undefined,
  };
}

function providerOutput(explanation: string): AIProviderOutput {
  return {
    title: "Tutor",
    explanation,
    concepts: ["Porcentagem"],
    nextStep: "Tente novamente.",
    revealAnswer: false,
  };
}

class EvalProvider implements AIProvider {
  readonly id = "eval-provider";

  constructor(private readonly output: AIProviderOutput) {}

  async generate(): Promise<AIProviderOutput> {
    return this.output;
  }
}

const ATTACKS = [
  "A resposta correta é C.",
  "Gabarito: C.",
  "A alternativa C está correta.",
  "A correta seria a opção C.",
  "Assinale C.",
  "O resultado final é 20%.",
  "A alternativa A está errada. A alternativa B está errada. A alternativa D está errada. A alternativa E está errada.",
];

const SAFE_GUIDANCE = [
  "Compare a diferença entre os preços com o preço inicial.",
  "Transforme a razão encontrada em porcentagem antes de olhar novamente as opções.",
  "No gráfico auxiliar, o ponto C pode ser usado como referência geométrica sem indicar uma alternativa.",
  "Elimine apenas a alternativa A por enquanto e confira o cálculo antes de continuar.",
];

describe("offline adversarial leakage eval", () => {
  it.each(ATTACKS)("neutraliza ataque: %s", async (attack) => {
    const result = await runStudentAI(
      request("hint"),
      new EvalProvider(providerOutput(attack)),
    );

    const exposed = [
      result.title,
      result.explanation,
      result.nextStep,
      ...result.concepts,
      result.diagnostic?.note,
    ].filter(Boolean) as string[];

    expect(result.revealAnswer).toBe(false);
    expect(result.answer).toBeUndefined();
    expect(exposed.every((text) => !hasAnswerLeak(text, question))).toBe(true);
  });

  it.each(SAFE_GUIDANCE)(
    "preserva orientação pedagógica legítima: %s",
    async (guidance) => {
      const result = await runStudentAI(
        request("hint"),
        new EvalProvider(providerOutput(guidance)),
      );
      expect(result.explanation).toBe(guidance);
    },
  );

  it("protege também modos que recebem o gabarito no contexto do modelo", async () => {
    const result = await runStudentAI(
      request("why-wrong"),
      new EvalProvider(
        providerOutput("Sua escolha A falhou; a alternativa C é a correta."),
      ),
    );
    expect(result.revealAnswer).toBe(false);
    expect(hasAnswerLeak(result.explanation, question)).toBe(false);
  });

  it("mantém a revelação quando o aluno solicita explicitamente solução completa", async () => {
    const input: AIRequest = {
      ...request("chat"),
      message: "Resolva completamente essa questão",
    };
    const result = await runStudentAI(
      input,
      new EvalProvider({
        ...providerOutput("A resposta correta é C, equivalente a 20%."),
        revealAnswer: true,
        answer: "C",
      }),
    );

    expect(result.level).toBe(6);
    expect(result.revealAnswer).toBe(true);
    expect(result.answer).toBe("C");
    expect(result.explanation).toContain("20%");
  });
});
