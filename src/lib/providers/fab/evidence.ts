import records from "./evidence.generated.json";
import type { ValidationLevel } from "../../sources/ingestion";
import type { FabAnswerKeyRaw } from "./index";

export interface FabEvidence {
  provider: string;
  year: number;
  originalUrl: string;
  effectiveSourceUrl: string;
  sourceType: string;
  fetchedAt: string | null;
  sha256: string;
  bytes: number;
  parserVersion: string;
  revision: string;
  validationLevel: string;
  validationEvidence: string[];
  datasetSignature?: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fabValidationLevel(provider: string, raw: FabAnswerKeyRaw,
  evidence: FabEvidence | undefined = (records as Record<string, FabEvidence>)[`${provider}-${raw.year}`],
): ValidationLevel {
  if (!evidence) return "provisional";
  if (evidence.validationLevel === "blocked") return "blocked";
  if (evidence.validationLevel !== "reviewed" || !evidence.fetchedAt || !evidence.validationEvidence.length) return "provisional";
  const fields = ["year", "total", "canonicalVariant", "revision", "sequence", "annulled",
    "variantAnswers", "subjects", "variantRelation", "subjectBoundariesVerified"] as const;
  const signature = stableJson(Object.fromEntries(fields.map((field) => [field, raw[field]])));
  if (evidence.provider !== provider || evidence.year !== raw.year ||
    evidence.originalUrl !== raw.answerKeyUrl || evidence.effectiveSourceUrl !== raw.retrieval.retrievedFrom ||
    evidence.sha256 !== raw.retrieval.sha256 || evidence.bytes !== raw.retrieval.bytes ||
    evidence.revision !== raw.revision || signature !== evidence.datasetSignature) return "blocked";
  return "reviewed";
}
