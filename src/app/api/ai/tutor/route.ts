import { NextResponse } from "next/server";
import { z } from "zod";
import { runStudentAI } from "@/lib/ai/service";

const assistanceModeSchema = z.enum([
  "hint",
  "explain",
  "guided-solve",
  "why-wrong",
  "explain-alternative",
  "study-needed",
  "similar-question",
  "chat",
]);

const alternativeSchema = z.object({
  letter: z.string().min(1).max(3),
  text: z.string().max(10_000),
});

const officialOriginSchema = z.object({
  kind: z.literal("official"),
  institution: z.literal("ENEM"),
  year: z.number().int().min(1998).max(2100),
  questionNumber: z.number().int().positive(),
});

const generatedOriginSchema = z.object({
  kind: z.literal("ai-generated"),
  label: z.literal("Questão gerada por IA — estilo ENEM"),
});

const requestSchema = z.object({
  mode: assistanceModeSchema,
  question: z.object({
    key: z.string().min(1).max(200),
    origin: z.union([officialOriginSchema, generatedOriginSchema]),
    statement: z.string().max(30_000),
    alternativesIntroduction: z.string().max(10_000).optional(),
    alternatives: z.array(alternativeSchema).max(8),
    correctAnswer: z.string().max(3).nullable().optional(),
    selectedAnswer: z.string().max(3).nullable().optional(),
    subject: z.string().min(1).max(120),
    topic: z.string().min(1).max(180),
    difficulty: z.enum(["facil", "media", "dificil"]).optional(),
    language: z.string().max(40).nullable().optional(),
  }),
  student: z
    .object({
      completedAttempts: z.number().int().nonnegative(),
      recentQuestions: z.number().int().nonnegative(),
      recentAccuracy: z.number().min(0).max(100).nullable(),
      topicQuestions: z.number().int().nonnegative(),
      topicAccuracy: z.number().min(0).max(100).nullable(),
      subjectQuestions: z.number().int().nonnegative(),
      subjectAccuracy: z.number().min(0).max(100).nullable(),
      highConfidenceErrors: z.number().int().nonnegative(),
      weakTopics: z
        .array(
          z.object({
            topic: z.string().max(180),
            accuracy: z.number().min(0).max(100),
            questions: z.number().int().nonnegative(),
          }),
        )
        .max(5),
    })
    .optional(),
  message: z.string().max(4_000).optional(),
  selectedAlternative: z.string().max(3).nullable().optional(),
  requestedLevel: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]).optional(),
  conversation: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4_000),
      }),
    )
    .max(12)
    .optional(),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Contexto de IA inválido.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (
    (parsed.data.mode === "why-wrong" || parsed.data.mode === "explain-alternative") &&
    !parsed.data.selectedAlternative &&
    !parsed.data.question.selectedAnswer
  ) {
    return NextResponse.json(
      { error: "Selecione uma alternativa antes de usar esta ação." },
      { status: 400 },
    );
  }

  try {
    const response = await runStudentAI(parsed.data);
    return NextResponse.json(response);
  } catch (error) {
    console.error("student-ai:error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao processar a ajuda da IA." },
      { status: 500 },
    );
  }
}
