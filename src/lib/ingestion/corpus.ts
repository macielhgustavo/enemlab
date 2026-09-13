import type { DiscoveredDocument, DocumentRole } from "../sources/ingestion";
import type { RightsStatus } from "../sources/types";

export type CorpusSourceAuthority = "official" | "mirror" | "aggregator" | "community" | "unknown";
export type CorpusAnswerKeyStatus = "preliminary" | "final" | "rectified" | "unknown";

export interface CorpusPackageFileV1 {
  kind: string;
  filename: string;
  url: string;
  sha256: string;
  size_bytes: number;
  authority?: CorpusSourceAuthority;
  canonical_url?: string;
  canonical_source_page?: string;
  canonical_authority?: CorpusSourceAuthority;
  verified_against_canonical?: boolean;
}

export interface CorpusPackageExamV1 {
  year: number;
  label: string;
  source_page: string;
  files: CorpusPackageFileV1[];
  /** Stable logical edition identity. Required by the generic reference adapter. */
  edition_id?: string;
  phase?: string;
  variant?: string;
  expected_questions?: number;
  allowed_letters?: string[];
  /** Final/preliminary answer metadata normalized from evidence, keyed by question number. */
  answer_key?: Record<number, string>;
  answer_key_status?: CorpusAnswerKeyStatus;
}

export interface CorpusPackageManifestV1 {
  schema_version: 1;
  package_id: string;
  collection: string;
  display_name: string;
  source: string;
  generated_from: string[];
  exams: CorpusPackageExamV1[];
}

export interface CorpusDocumentEvidence {
  packageId: string;
  collection: string;
  sourceName: string;
  sourceAuthority: CorpusSourceAuthority;
  rightsStatus: RightsStatus;
  year: number;
  label: string;
  sourcePage: string;
  kind: string;
  filename: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  fileAuthority?: CorpusSourceAuthority;
  canonicalUrl?: string;
  canonicalSourcePage?: string;
  canonicalAuthority?: CorpusSourceAuthority;
  verifiedAgainstCanonical?: boolean;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("corpus manifest must be an object");
  }
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalNonEmpty(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return nonEmpty(value, field);
}

function webUrl(value: unknown, field: string): string {
  const raw = nonEmpty(value, field);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field} must be a URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${field} must use http or https`);
  }
  return raw;
}

function optionalWebUrl(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return webUrl(value, field);
}

function sha256(value: unknown, field: string): string {
  const raw = nonEmpty(value, field).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) throw new Error(`${field} must be SHA-256`);
  return raw;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be positive`);
  return Number(value);
}

function sourceAuthority(value: unknown, field: string): CorpusSourceAuthority | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    value === "official" ||
    value === "mirror" ||
    value === "aggregator" ||
    value === "community" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error(`${field} has unsupported authority`);
}

function answerKeyStatus(value: unknown, field: string): CorpusAnswerKeyStatus | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "preliminary" || value === "final" || value === "rectified" || value === "unknown") {
    return value;
  }
  throw new Error(`${field} has unsupported status`);
}

function allowedLetters(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 2) throw new Error(`${field} must contain at least two letters`);
  const letters = value.map((item, index) => nonEmpty(item, `${field}[${index}]`).toUpperCase());
  if (letters.some((letter) => !/^[A-Z]$/.test(letter))) throw new Error(`${field} must contain A-Z letters`);
  if (new Set(letters).size !== letters.length) throw new Error(`${field} contains duplicate letters`);
  return letters;
}

function normalizedAnswerKey(
  value: unknown,
  field: string,
  expectedQuestions?: number,
  letters?: string[],
): Record<number, string> | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = record(value);
  const out: Record<number, string> = {};
  for (const [rawNumber, rawAnswer] of Object.entries(raw)) {
    const number = Number(rawNumber);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${field} has invalid question number ${rawNumber}`);
    const answer = nonEmpty(rawAnswer, `${field}.${rawNumber}`).toUpperCase();
    if (letters && !letters.includes(answer)) throw new Error(`${field}.${rawNumber} is outside allowed_letters`);
    out[number] = answer;
  }
  if (expectedQuestions !== undefined) {
    const numbers = Object.keys(out).map(Number).sort((a, b) => a - b);
    if (numbers.length !== expectedQuestions) throw new Error(`${field} must contain ${expectedQuestions} answers`);
    for (let number = 1; number <= expectedQuestions; number++) {
      if (out[number] === undefined) throw new Error(`${field} is missing question ${number}`);
    }
  }
  return out;
}

/** Parses only the resolved package manifest written inside a corpus release ZIP. */
export function parseCorpusPackageManifestV1(payload: unknown): CorpusPackageManifestV1 {
  const root = record(payload);
  if (root.schema_version !== 1) throw new Error("unsupported corpus schema_version");
  if (!Array.isArray(root.generated_from)) throw new Error("generated_from must be an array");
  if (!Array.isArray(root.exams)) throw new Error("exams must be an array");

  const manifest: CorpusPackageManifestV1 = {
    schema_version: 1,
    package_id: nonEmpty(root.package_id, "package_id"),
    collection: nonEmpty(root.collection, "collection"),
    display_name: nonEmpty(root.display_name, "display_name"),
    source: nonEmpty(root.source, "source"),
    generated_from: root.generated_from.map((item, index) => nonEmpty(item, `generated_from[${index}]`)),
    exams: root.exams.map((rawExam, examIndex) => {
      const exam = record(rawExam);
      if (!Array.isArray(exam.files) || exam.files.length === 0) {
        throw new Error(`exams[${examIndex}].files must be non-empty`);
      }
      const expectedQuestions = exam.expected_questions === undefined
        ? undefined
        : positiveInteger(exam.expected_questions, `exams[${examIndex}].expected_questions`);
      const letters = allowedLetters(exam.allowed_letters, `exams[${examIndex}].allowed_letters`);
      const seenNames = new Set<string>();
      const seenUrls = new Set<string>();
      const files = exam.files.map((rawFile, fileIndex) => {
        const file = record(rawFile);
        const filename = nonEmpty(file.filename, `exams[${examIndex}].files[${fileIndex}].filename`);
        const url = webUrl(file.url, `exams[${examIndex}].files[${fileIndex}].url`);
        if (seenNames.has(filename)) throw new Error(`duplicate corpus filename ${filename}`);
        if (seenUrls.has(url)) throw new Error(`duplicate corpus URL ${url}`);
        seenNames.add(filename);
        seenUrls.add(url);
        return {
          kind: nonEmpty(file.kind, `exams[${examIndex}].files[${fileIndex}].kind`),
          filename,
          url,
          sha256: sha256(file.sha256, `exams[${examIndex}].files[${fileIndex}].sha256`),
          size_bytes: positiveInteger(file.size_bytes, `exams[${examIndex}].files[${fileIndex}].size_bytes`),
          authority: sourceAuthority(file.authority, `exams[${examIndex}].files[${fileIndex}].authority`),
          canonical_url: optionalWebUrl(file.canonical_url, `exams[${examIndex}].files[${fileIndex}].canonical_url`),
          canonical_source_page: optionalWebUrl(file.canonical_source_page, `exams[${examIndex}].files[${fileIndex}].canonical_source_page`),
          canonical_authority: sourceAuthority(file.canonical_authority, `exams[${examIndex}].files[${fileIndex}].canonical_authority`),
          verified_against_canonical: file.verified_against_canonical === undefined
            ? undefined
            : Boolean(file.verified_against_canonical),
        };
      });
      const answerKey = normalizedAnswerKey(
        exam.answer_key,
        `exams[${examIndex}].answer_key`,
        expectedQuestions,
        letters,
      );
      return {
        year: positiveInteger(exam.year, `exams[${examIndex}].year`),
        label: nonEmpty(exam.label, `exams[${examIndex}].label`),
        source_page: webUrl(exam.source_page, `exams[${examIndex}].source_page`),
        files,
        edition_id: optionalNonEmpty(exam.edition_id, `exams[${examIndex}].edition_id`),
        phase: optionalNonEmpty(exam.phase, `exams[${examIndex}].phase`),
        variant: optionalNonEmpty(exam.variant, `exams[${examIndex}].variant`),
        expected_questions: expectedQuestions,
        allowed_letters: letters,
        answer_key: answerKey,
        answer_key_status: answerKeyStatus(exam.answer_key_status, `exams[${examIndex}].answer_key_status`),
      };
    }),
  };

  return manifest;
}

export function corpusEvidence(
  manifest: CorpusPackageManifestV1,
  sourceAuthorityValue: CorpusSourceAuthority,
  rightsStatus: RightsStatus,
): CorpusDocumentEvidence[] {
  return manifest.exams.flatMap((exam) =>
    exam.files.map((file) => ({
      packageId: manifest.package_id,
      collection: manifest.collection,
      sourceName: manifest.source,
      sourceAuthority: sourceAuthorityValue,
      rightsStatus,
      year: exam.year,
      label: exam.label,
      sourcePage: exam.source_page,
      kind: file.kind,
      filename: file.filename,
      url: file.url,
      sha256: file.sha256,
      sizeBytes: file.size_bytes,
      fileAuthority: file.authority,
      canonicalUrl: file.canonical_url,
      canonicalSourcePage: file.canonical_source_page,
      canonicalAuthority: file.canonical_authority,
      verifiedAgainstCanonical: file.verified_against_canonical,
    })),
  );
}

function roleOf(kind: string): DocumentRole | null {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "prova" || normalized === "exam" || normalized === "objective-exam") {
    return "objective-exam";
  }
  if (normalized === "gabarito" || normalized === "answer-key") return "answer-key";
  if (normalized === "gabarito-preliminar" || normalized === "answer-key-preliminary") {
    return "answer-key-preliminary";
  }
  return null;
}

/**
 * Converts corpus evidence into the neutral documents consumed by an adapter.
 * Unknown document kinds remain evidence but are not silently assigned a role.
 */
export function corpusDocumentsForExam(exam: CorpusPackageExamV1): DiscoveredDocument[] {
  return exam.files.flatMap((file) => {
    const role = roleOf(file.kind);
    return role
      ? [{ role, url: file.url, phase: exam.phase, variant: exam.variant }]
      : [];
  });
}
