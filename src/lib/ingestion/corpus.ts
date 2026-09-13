import type { DiscoveredDocument, DocumentRole } from "../sources/ingestion";
import type { RightsStatus } from "../sources/types";

export type CorpusSourceAuthority = "official" | "mirror" | "aggregator" | "community" | "unknown";

export interface CorpusPackageFileV1 {
  kind: string;
  filename: string;
  url: string;
  sha256: string;
  size_bytes: number;
}

export interface CorpusPackageExamV1 {
  year: number;
  label: string;
  source_page: string;
  files: CorpusPackageFileV1[];
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

function sha256(value: unknown, field: string): string {
  const raw = nonEmpty(value, field).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) throw new Error(`${field} must be SHA-256`);
  return raw;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be positive`);
  return Number(value);
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
        };
      });
      return {
        year: positiveInteger(exam.year, `exams[${examIndex}].year`),
        label: nonEmpty(exam.label, `exams[${examIndex}].label`),
        source_page: webUrl(exam.source_page, `exams[${examIndex}].source_page`),
        files,
      };
    }),
  };

  return manifest;
}

export function corpusEvidence(
  manifest: CorpusPackageManifestV1,
  sourceAuthority: CorpusSourceAuthority,
  rightsStatus: RightsStatus,
): CorpusDocumentEvidence[] {
  return manifest.exams.flatMap((exam) =>
    exam.files.map((file) => ({
      packageId: manifest.package_id,
      collection: manifest.collection,
      sourceName: manifest.source,
      sourceAuthority,
      rightsStatus,
      year: exam.year,
      label: exam.label,
      sourcePage: exam.source_page,
      kind: file.kind,
      filename: file.filename,
      url: file.url,
      sha256: file.sha256,
      sizeBytes: file.size_bytes,
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
    return role ? [{ role, url: file.url }] : [];
  });
}
