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

const generatedQuestionDraftSchema = z
  .object({
    statement: z.string().min(1).max(20_000),
    alternatives: z.array(providerAlternativeSchema).min(2).max(8),
    correctAnswer: z.string().min(1).max(3),
    explanation: z.string().max(8_000).optional(),
  })
  .strict();

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
