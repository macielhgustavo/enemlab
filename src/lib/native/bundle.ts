import { z } from "zod";
import {
  validateStructuredQuestion,
  withStructuredQuestionContent,
} from "../providers/structuredRegistry";
import type { NormalizedQuestion } from "../providers/types";

const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:");
const assetUrl = z
  .string()
  .refine(
    (value) =>
      (/^\/native\/assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.includes("..")) ||
      httpsUrl.safeParse(value).success,
    "Media must use HTTPS or a local native asset",
  );
const phase = z.enum(["day1", "day2", "single", "first", "second", "morning", "afternoon"]);
const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const nativeQuestionSchema = z
  .object({
    providerId: identifier,
    examId: z.string().min(1),
    editionId: z.string().min(1).nullable(),
    language: z.string().min(1).nullable(),
    year: z.number().int().min(1900),
    number: z.number().int().positive(),
    phase,
    statement: z.string().trim().min(1),
    context: z.string().optional(),
    alternativesIntroduction: z.string().optional(),
    alternatives: z
      .array(
        z
          .object({
            letter: z.string().regex(/^[A-Z0-9]+$/),
            text: z.string().optional(),
            file: assetUrl.optional(),
          })
          .strict(),
      )
      .min(2),
    files: z.array(assetUrl).optional(),
    sources: z
      .array(z.object({ label: z.string().trim().min(1), url: httpsUrl.optional() }).strict())
      .optional(),
    validationLevel: z.enum(["reviewed", "verified"]),
    provenance: z
      .object({
        documentUrl: httpsUrl,
        page: z.number().int().positive().optional(),
        documentSha256: sha256,
        parserVersion: z.string().trim().min(1),
        extractionMethod: z.enum(["api", "html-parse", "pdf-text-layer", "manual"]),
        rightsStatus: z.literal("allowed"),
        rightsEvidenceUrl: httpsUrl,
        reviewedAt: z.iso.datetime({ offset: true }),
        reviewedBy: z.string().trim().min(1),
        revision: z.enum(["final", "rectified"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((question, context) => {
    try {
      validateStructuredQuestion(question);
    } catch (error) {
      context.addIssue({ code: "custom", message: String(error) });
    }
  });

export const nativeBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    providerId: identifier,
    year: z.number().int().min(1900),
    editionId: z.string().min(1).nullable(),
    questions: z.array(nativeQuestionSchema).min(1),
  })
  .strict();

export const nativeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(
      z
        .object({
          providerId: identifier,
          year: z.number().int().min(1900),
          editionId: z.string().min(1).nullable(),
          path: z.string().regex(/^\/native\/editions\/[a-f0-9]{64}\.json$/),
          sha256,
          questionCount: z.number().int().positive(),
          coverage: z.partialRecord(phase, z.number().int().positive()),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((manifest, context) => {
    const keys = manifest.entries.map(editionKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Duplicate native edition" });
    }
    for (const entry of manifest.entries) {
      if (
        Object.values(entry.coverage).reduce((sum, count) => sum + (count ?? 0), 0) !==
        entry.questionCount
      ) {
        context.addIssue({ code: "custom", message: "Native coverage count mismatch" });
      }
      if (entry.path !== `/native/editions/${entry.sha256}.json`) {
        context.addIssue({ code: "custom", message: "Native path must identify its checksum" });
      }
    }
  });

export type NativeBundle = z.infer<typeof nativeBundleSchema>;
export type NativeManifest = z.infer<typeof nativeManifestSchema>;

export function nativeCoverage(bundle: NativeBundle): Record<string, number> {
  const coverage: Record<string, number> = {};
  for (const question of bundle.questions)
    coverage[question.phase] = (coverage[question.phase] ?? 0) + 1;
  return coverage;
}

export function editionKey(edition: {
  providerId: string;
  year: number;
  editionId?: string | null;
}): string {
  return JSON.stringify([edition.providerId, edition.year, edition.editionId ?? null]);
}

function identity(question: {
  providerId: string;
  examId: string;
  editionId?: string | null;
  year: number;
  phase: string;
  number?: number;
  index?: number;
  language: string | null;
}): string {
  return JSON.stringify([
    question.providerId,
    question.examId,
    question.editionId ?? null,
    question.year,
    question.phase,
    question.number ?? question.index,
    question.language,
  ]);
}

export function applyNativeBundle(
  base: NormalizedQuestion[],
  input: unknown,
): NormalizedQuestion[] {
  const bundle = nativeBundleSchema.parse(input);
  const targets = new Map(base.map((question) => [identity(question), question]));
  if (targets.size !== base.length) throw new Error("Duplicate provider question identity");
  const overlays = new Map<string, NormalizedQuestion>();
  for (const question of bundle.questions) {
    if (editionKey(question) !== editionKey(bundle)) throw new Error("Native edition mismatch");
    const key = identity(question);
    const original = targets.get(key);
    if (!original) throw new Error("Native question has no exact provider match");
    if (overlays.has(key)) throw new Error("Duplicate native question identity");
    if (
      !original.official?.official ||
      original.official.documentUrl.split("#")[0] !==
        question.provenance.documentUrl.split("#")[0]
    ) {
      throw new Error("Native source does not match the provider document/variant");
    }
    overlays.set(
      key,
      withStructuredQuestionContent(original, question, original.official.institution),
    );
  }
  return base.map((question) => overlays.get(identity(question)) ?? question);
}
