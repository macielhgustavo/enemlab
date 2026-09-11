import { describe, expect, it } from "vitest";
import {
  detectAnswerLeak,
  hasAnswerLeak,
  sanitizeProviderOutputForLeaks,
} from "./leakage";
import type { AIProviderOutput, AIQuestionContext } from "./types";

function question(): AIQuestionContext {
  return {
    key: "leak-test",
    origin: {
      kind: "ai-generated",
      label: "Questão gerada por IA — estilo avaliação",
      style: "avaliação",
    },
    statement: "Um produto passou de 100 reais para 120 reais.",
    alternativesIntroduction: "A variação percentual do preço foi de",
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
}

function output(overrides: Partial<AIProviderOutput> = {}): AIProviderOutput {
  return {
    title: "Pense na variação",
    explanation: "Compare a diferença com o valor inicial.",
    concepts: ["Porcentagem"],
    nextStep: "Calcule primeiro a diferença entre os preços.",
    revealAnswer: false,
    ...overrides,
  };
}

describe("semantic answer leakage guard", () => {
  it("detecta letra correta quando o texto declara o gabarito", () => {
    expect(detectAnswerLeak("A resposta correta é C.", question())).toContainEqual({
      kind: "explicit-answer",
    });
    expect(hasAnswerLeak("Gabarito: C", question())).toBe(true);
    expect(hasAnswerLeak("A alternativa C está correta.", question())).toBe(true);
    expect(hasAnswerLeak("Assinale a letra C.", question())).toBe(true);
  });

  it("não confunde uma letra isolada em outro contexto com gabarito", () => {
    expect(hasAnswerLeak("No gráfico, observe o ponto C antes de calcular.", question())).toBe(
      false,
    );
  });

  it("detecta o texto ou valor distintivo da alternativa correta", () => {
    expect(detectAnswerLeak("O resultado encontrado é 20%.", question())).toContainEqual({
      kind: "correct-option-text",
    });
  });

  it("detecta revelação por eliminação de todas as alternativas erradas", () => {
    const text = [
      "A alternativa A está errada.",
      "A alternativa B está incorreta.",
      "A alternativa D deve ser descartada.",
      "A alternativa E está errada.",
    ].join(" ");
    expect(detectAnswerLeak(text, question())).toContainEqual({ kind: "elimination" });
  });

  it("não bloqueia eliminação parcial que ainda preserva escolha real", () => {
    const text =
      "A alternativa A está errada e a alternativa B está incorreta. Compare as restantes.";
    expect(hasAnswerLeak(text, question())).toBe(false);
  });

  it("sanitiza todos os campos livres antes do nível 6", () => {
    const raw = output({
      title: "Gabarito: C",
      explanation: "O resultado é 20%, então a alternativa C está correta.",
      concepts: ["Porcentagem", "20%"],
      nextStep: "Marque a alternativa C.",
      revealAnswer: true,
      answer: "C",
      diagnostic: {
        category: "calculation",
        confidence: "high",
        note: "Você errou porque a correta é C.",
      },
      highlights: [
        {
          text: "passou de 100 reais para 120 reais",
          role: "data",
          note: "Esse trecho leva diretamente aos 20%.",
        },
      ],
    });

    const safe = sanitizeProviderOutputForLeaks(raw, question(), false);
    const visible = [
      safe.title,
      safe.explanation,
      safe.nextStep,
      ...safe.concepts,
      safe.diagnostic?.note,
      ...(safe.highlights || []).map((highlight) => highlight.note),
    ].filter(Boolean) as string[];

    expect(safe.revealAnswer).toBe(false);
    expect(safe.answer).toBeUndefined();
    expect(safe.diagnostic).toMatchObject({
      category: "calculation",
      confidence: "high",
    });
    expect(visible.every((text) => !hasAnswerLeak(text, question()))).toBe(true);
    expect(safe.concepts).toEqual(["Porcentagem"]);
  });

  it("não altera a resposta quando a política permite nível 6", () => {
    const raw = output({
      explanation: "A resposta correta é C, correspondente a 20%.",
      revealAnswer: true,
      answer: "C",
    });
    expect(sanitizeProviderOutputForLeaks(raw, question(), true)).toBe(raw);
  });
});
