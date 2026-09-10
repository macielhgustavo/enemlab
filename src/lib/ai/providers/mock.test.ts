import { describe, expect, it } from "vitest";
import { MockAIProvider } from "./mock";
import type { AIProviderRequest } from "../types";

describe("MockAIProvider assistance-aware guidance", () => {
  it("distingue taxa bruta de evidência independente sem reinterpretar a nota", async () => {
    const input: AIProviderRequest = {
      request: {
        mode: "study-needed",
        question: {
          key: "2023-1-pt-matematica",
          origin: {
            kind: "official",
            providerId: "enem",
            institution: "ENEM",
            year: 2023,
            questionNumber: 1,
          },
          statement: "Questão de porcentagem.",
          alternatives: [
            { letter: "A", text: "Um" },
            { letter: "B", text: "Dois" },
          ],
          subject: "Matemática",
          topic: "Porcentagem e juros",
        },
        student: {
          completedAttempts: 2,
          recentQuestions: 10,
          recentAccuracy: 80,
          recentIndependence: {
            independentQuestions: 8,
            independentAccuracy: 75,
            highAssistanceQuestions: 2,
            correctWithHighAssistance: 2,
            correctWithHighAssistanceShare: 25,
          },
          topicQuestions: 5,
          topicAccuracy: 80,
          topicIndependence: {
            independentQuestions: 3,
            independentAccuracy: 60,
            highAssistanceQuestions: 2,
            correctWithHighAssistance: 1,
            correctWithHighAssistanceShare: 25,
          },
          subjectQuestions: 10,
          subjectAccuracy: 80,
          subjectIndependence: {
            independentQuestions: 8,
            independentAccuracy: 75,
            highAssistanceQuestions: 2,
            correctWithHighAssistance: 2,
            correctWithHighAssistanceShare: 25,
          },
          currentQuestionAssistance: null,
          highConfidenceErrors: 0,
          weakTopics: [],
        },
      },
      policy: {
        mode: "study-needed",
        level: 2,
        revealAnswer: false,
        includeCorrectAnswerInModelContext: false,
        objective: "Identificar conteúdos para revisar.",
      },
      systemPrompt: "",
      userPrompt: "",
    };

    const output = await new MockAIProvider().generate(input);
    expect(output.explanation).toContain("taxa bruta é 80%");
    expect(output.explanation).toContain("evidência sem assistência alta é 60%");
    expect(output.explanation).toContain("não altera sua nota oficial");
  });
});
