import type { DiscoveredEdition, ExamSourceDiscovery } from "../../sources/ingestion";
import type { RightsStatus } from "../../sources/types";
import {
  corpusDocumentsForExam,
  type CorpusPackageExamV1,
  type CorpusPackageManifestV1,
} from "../corpus";
import type { ExtractedExamData, IngestionAdapter, IngestionExtractionContext, IngestionPlan } from "../types";

export interface ReferenceCorpusAdapterOptions {
  providerId: string;
  sourceId: string;
  importerVersion: string;
  manifest: CorpusPackageManifestV1;
  rightsStatus: RightsStatus;
  subjectLabel?: string;
}

type ReadyReferenceExam = CorpusPackageExamV1 & {
  edition_id: string;
  phase: string;
  expected_questions: number;
  allowed_letters: string[];
  answer_key: Record<number, string>;
  answer_key_status: "preliminary" | "final" | "rectified";
};

function isReadyReferenceExam(exam: CorpusPackageExamV1): exam is ReadyReferenceExam {
  if (!exam.edition_id || !exam.phase || !exam.expected_questions) return false;
  if (!exam.allowed_letters || exam.allowed_letters.length < 2) return false;
  if (!exam.answer_key || !exam.answer_key_status || exam.answer_key_status === "unknown") return false;
  if (Object.keys(exam.answer_key).length !== exam.expected_questions) return false;
  return corpusDocumentsForExam(exam).some(
    (document) => document.role === "answer-key" || document.role === "answer-key-preliminary",
  );
}

function editionFor(exam: CorpusPackageExamV1): DiscoveredEdition {
  return {
    editionId: exam.edition_id ?? exam.label,
    year: exam.year,
    label: exam.label,
    documents: corpusDocumentsForExam(exam),
  };
}

function findExam(manifest: CorpusPackageManifestV1, editionId: string): CorpusPackageExamV1 | undefined {
  return manifest.exams.find((exam) => (exam.edition_id ?? exam.label) === editionId);
}

function assertCorpusBytes(exam: CorpusPackageExamV1, context: IngestionExtractionContext): void {
  const expected = new Map(exam.files.map((file) => [file.url, file]));
  for (const document of context.documents) {
    const file = expected.get(document.definition.url);
    if (!file) throw new Error(`corpus evidence missing for ${document.definition.url}`);
    if (document.fingerprint.sha256 !== file.sha256) {
      throw new Error(`corpus SHA-256 mismatch for ${file.filename}`);
    }
    if (document.fingerprint.contentLength !== file.size_bytes) {
      throw new Error(`corpus byte-size mismatch for ${file.filename}`);
    }
  }
  if (context.documents.length !== corpusDocumentsForExam(exam).length) {
    throw new Error("not all corpus documents were fetched");
  }
}

/**
 * Generic bridge from an audited corpus package into the mass-ingestion engine.
 *
 * The corpus owns document identity/provenance and a minimal normalized answer
 * key. The adapter verifies fetched bytes against the package hashes, then emits
 * reference-only questions. It never republishes statements from mirrored PDFs.
 */
export function createReferenceCorpusAdapter(options: ReferenceCorpusAdapterOptions): IngestionAdapter {
  const { manifest } = options;
  const discovery: ExamSourceDiscovery = {
    sourceId: options.sourceId,
    async discover() {
      return manifest.exams.map(editionFor);
    },
    isAllowed(edition) {
      const exam = findExam(manifest, edition.editionId);
      return Boolean(exam && isReadyReferenceExam(exam));
    },
  };

  return {
    providerId: options.providerId,
    sourceId: options.sourceId,
    importerVersion: options.importerVersion,
    discovery,
    statementMode: "reference-only",
    extractionMethod: "manual",
    rightsStatus: options.rightsStatus,
    plan(edition): IngestionPlan[] {
      const exam = findExam(manifest, edition.editionId);
      if (!exam || !isReadyReferenceExam(exam)) {
        throw new Error(`${options.providerId} ${edition.editionId}: corpus metadata is not review-ready`);
      }
      return [
        {
          editionId: exam.edition_id,
          year: exam.year,
          phase: exam.phase,
          variant: exam.variant,
          expectedCount: exam.expected_questions,
          allowedLetters: [...exam.allowed_letters],
          documents: corpusDocumentsForExam(exam),
        },
      ];
    },
    async extract(context): Promise<ExtractedExamData> {
      const exam = findExam(manifest, context.plan.editionId);
      if (!exam || !isReadyReferenceExam(exam)) {
        throw new Error(`${options.providerId} ${context.plan.editionId}: corpus metadata is not review-ready`);
      }
      assertCorpusBytes(exam, context);
      const sourceDocumentUrl = context.documents.find(
        (document) => document.definition.role === "objective-exam",
      )?.definition.url ?? exam.source_page;
      const subject = options.subjectLabel ?? "Conhecimentos gerais";
      return {
        questions: Array.from({ length: exam.expected_questions }, (_, index) => ({
          number: index + 1,
          subject,
          sourceDocumentUrl,
        })),
        answerKey: { ...exam.answer_key },
        annulled: [],
        subjects: { [subject]: exam.expected_questions },
        warnings: [
          `Corpus ${manifest.package_id}: conteúdo em modo referência; PDFs foram fingerprintados e o gabarito normalizado segue para revisão humana.`,
        ],
      };
    },
  };
}
