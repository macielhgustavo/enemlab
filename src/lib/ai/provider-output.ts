import { z } from "zod";
import type { AIProviderOutput } from "./types";

const providerAlternativeSchema = z
  .object({
    letter: z.string().min(1).max(3),
    text: z.string().min(1).max(8_000),
    file: z.string().max(2_000).nullable().optional(),
  })
  .strict();

const diagnosticSchema = z
  .object({
    category: z.enum([
      "content-gap",
      "interpretation",
      "calculation",
      "strategy",
      "attention",
      "unknown",
    ]),
    confidence: z.enum(["low", "medium", "high"]),
    note: z.string().min(1).max(1_500),
  })
  .strict();

const semanticHighlightSchema = z
  .object({
    text: z.string().min(4).max(240),
    role: z.enum(["objective", "condition", "data", "concept", "trap", "signal"]),
    note: z.string().min(1).max(600),
  })
  .strict();

const generatedQuestionDraftSchema = z
  .object({
    statement: z.string().min(1).max(20_000),
    alternatives: z.array(providerAlternativeSchema).min(2).max(8),
    correctAnswer: z.string().min(1).max(3),
    explanation: z.string().max(8_000).optional(),
  })
  .strict();

/**
 * JSON Schema enviado ao OpenRouter. Mantemos a validação Zod abaixo como
 * segunda barreira, porque o provider externo nunca é uma fronteira confiável.
 */
export const aiProviderOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 240 },
    explanation: { type: "string", minLength: 1, maxLength: 20_000 },
    concepts: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 180 },
    },
    nextStep: { type: "string", minLength: 1, maxLength: 4_000 },
    revealAnswer: { type: "boolean" },
    answer: { type: "string", maxLength: 3 },
    diagnostic: {
      type: "object",
      additionalProperties: false,
      properties: {
        category: {
          type: "string",
          enum: [
            "content-gap",
            "interpretation",
            "calculation",
            "strategy",
            "attention",
            "unknown",
          ],
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        note: { type: "string", minLength: 1, maxLength: 1_500 },
      },
      required: ["category", "confidence", "note"],
    },
    highlights: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", minLength: 4, maxLength: 240 },
          role: {
            type: "string",
            enum: ["objective", "condition", "data", "concept", "trap", "signal"],
          },
          note: { type: "string", minLength: 1, maxLength: 600 },
        },
        required: ["text", "role", "note"],
      },
    },
    generatedQuestion: {
      type: "object",
      additionalProperties: false,
      properties: {
        statement: { type: "string", minLength: 1, maxLength: 20_000 },
        alternatives: {
          type: "array",
          minItems: 2,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              letter: { type: "string", minLength: 1, maxLength: 3 },
              text: { type: "string", minLength: 1, maxLength: 8_000 },
              file: { type: ["string", "null"], maxLength: 2_000 },
            },
            required: ["letter", "text"],
          },
        },
        correctAnswer: { type: "string", minLength: 1, maxLength: 3 },
        explanation: { type: "string", maxLength: 8_000 },
      },
      required: ["statement", "alternatives", "correctAnswer"],
    },
  },
  required: ["title", "explanation", "concepts", "nextStep", "revealAnswer"],
} as const;

/**
 * Fronteira de confiança entre um LLM externo e o produto. O modelo só pode
 * preencher conteúdo pedagógico; decisões de política e procedência ficam
 * fora deste schema e são impostas pelo ENEMLab depois.
 */
export const aiProviderOutputSchema = z
  .object({
    title: z.string().min(1).max(240),
    explanation: z.string().min(1).max(20_000),
    concepts: z.array(z.string().min(1).max(180)).max(8),
    nextStep: z.string().min(1).max(4_000),
    revealAnswer: z.boolean(),
    answer: z.string().max(3).optional(),
    diagnostic: diagnosticSchema.optional(),
    highlights: z.array(semanticHighlightSchema).max(6).optional(),
    generatedQuestion: generatedQuestionDraftSchema.optional(),
  })
  .strict();

export function parseAIProviderOutput(value: unknown): AIProviderOutput {
  const parsed = aiProviderOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("O provider de IA retornou dados fora do contrato estruturado esperado.");
  }
  return parsed.data;
}
