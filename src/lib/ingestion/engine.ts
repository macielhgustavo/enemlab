import {
  compareFingerprints,
  validateEdition,
  type DiscoveredEdition,
  type DocumentFetcher,
  type RawImportedExam,
} from "../sources/ingestion";
import type { StatementMode } from "../sources/types";
import { mapWithConcurrency } from "./concurrency";
import { fingerprintFetchedDocument } from "./fingerprint";
import {
  assessSemanticFidelity,
  buildSelectiveFallbackRequest,
  issueBlocksQuestion,
  mergeSelectiveFallback,
  questionHasCompleteStructure,
} from "./semanticFidelity";
import type {
  ExtractedExamData,
  IngestionAdapter,
  IngestionEngineIssue,
  IngestionEngineOptions,
  IngestionFallbackSummary,
  IngestionJobResult,
  IngestionPlan,
  IngestionReviewItem,
  IngestionRunResult,
  IngestionSourceFailure,
  SkippedEdition,
  StagedImportedExam,
} from "./types";

interface PlannedJob {
  adapter: IngestionAdapter;
  plan: IngestionPlan;
  jobKey: string;
}

function normalizeIdentityPart(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "default"
  );
}

/**
 * Stable identity of a logical exam ingestion job. Source is deliberately not
 * part of the key: two adapters claiming the same provider/edition/phase/
 * variant must collide instead of silently creating duplicate exams.
 */
export function buildIngestionJobKey(providerId: string, plan: IngestionPlan): string {
  return [providerId, plan.editionId, plan.phase, plan.variant ?? "default"]
    .map(normalizeIdentityPart)
    .join(":");
}

function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validatePlan(
  plan: IngestionPlan,
  edition: DiscoveredEdition,
  statementMode: StatementMode,
): string[] {
  const problems: string[] = [];

  if (!plan.editionId.trim()) problems.push("editionId is required");
  if (plan.editionId !== edition.editionId) {
    problems.push(`editionId ${plan.editionId} does not match discovered ${edition.editionId}`);
  }
  if (plan.year !== edition.year) {
    problems.push(`year ${plan.year} does not match discovered ${edition.year}`);
  }
  if (!plan.phase.trim()) problems.push("phase is required");
  if (!Number.isInteger(plan.expectedCount) || plan.expectedCount < 1) {
    problems.push("expectedCount must be a positive integer");
  }

  const letters = plan.allowedLetters.map((letter) => letter.trim());
  if (letters.length < 2) problems.push("allowedLetters must declare at least two answer IDs");
  if (letters.some((letter) => !/^[A-Z0-9]+$/.test(letter))) {
    problems.push("allowedLetters must use canonical uppercase alphanumeric IDs");
  }
  if (new Set(letters).size !== letters.length) {
    problems.push("allowedLetters contains duplicates");
  }

  if (!plan.documents.length) problems.push("plan has no documents");
  const urls = plan.documents.map((document) => document.url);
  if (urls.some((url) => !isWebUrl(url))) problems.push("plan contains an invalid document URL");
  if (new Set(urls).size !== urls.length) problems.push("plan contains duplicate document URLs");

  const examDocuments = plan.documents.filter(
    (document) => document.role === "objective-exam" || document.role === "subject-exam",
  );
  if (statementMode !== "reference-only" && !examDocuments.length) {
    problems.push("native/structured objective plan has no exam document");
  }

  const answerDocuments = plan.documents.filter(
    (document) =>
      document.role === "answer-key" || document.role === "answer-key-preliminary",
  );
  if (!answerDocuments.length) problems.push("objective plan has no answer-key document");

  for (const document of plan.documents) {
    if (document.phase && document.phase !== plan.phase) {
      problems.push(`document ${document.url} belongs to phase ${document.phase}, not ${plan.phase}`);
    }
    if (document.variant && plan.variant && document.variant !== plan.variant) {
      problems.push(
        `document ${document.url} belongs to variant ${document.variant}, not ${plan.variant}`,
      );
    }
  }

  return problems;
}

function validateExtraction(data: ExtractedExamData): string[] {
  const problems: string[] = [];

  if (!Array.isArray(data.questions)) return ["extractor did not return a questions array"];
  if (!data.answerKey || typeof data.answerKey !== "object") {
    problems.push("extractor did not return an answerKey object");
  }

  for (const question of data.questions) {
    if (!Number.isInteger(question.number) || question.number < 1) {
      problems.push(`invalid question number ${question.number}`);
    }
    if (
      question.confidence !== undefined &&
      (question.confidence < 0 || question.confidence > 1 || !Number.isFinite(question.confidence))
    ) {
      problems.push(`question ${question.number} has confidence outside 0..1`);
    }
    if (question.page !== undefined && (!Number.isInteger(question.page) || question.page < 1)) {
      problems.push(`question ${question.number} has an invalid page`);
    }
    if (question.sourceDocumentUrl && !isWebUrl(question.sourceDocumentUrl)) {
      problems.push(`question ${question.number} has an invalid sourceDocumentUrl`);
    }
    if (question.files?.some((file) => !file.trim())) {
      problems.push(`question ${question.number} contains an empty media path`);
    }
    if (question.alternatives) {
      const ids = question.alternatives.map((alternative) => alternative.id.trim());
      if (ids.some((id) => !/^[A-Z0-9]+$/.test(id))) {
        problems.push(`question ${question.number} has a non-canonical alternative ID`);
      }
      if (new Set(ids).size !== ids.length) {
        problems.push(`question ${question.number} has duplicate alternative IDs`);
      }
    }
  }

  if (
    data.questionsMissingMedia?.some(
      (number) => !Number.isInteger(number) || number < 1,
    )
  ) {
    problems.push("questionsMissingMedia contains an invalid question number");
  }

  for (const issue of data.semanticFidelityIssues ?? []) {
    if (!issue.message?.trim()) problems.push("semanticFidelityIssues contains an empty message");
    if (
      issue.questionNumber !== undefined &&
      (!Number.isInteger(issue.questionNumber) || issue.questionNumber < 1)
    ) {
      problems.push("semanticFidelityIssues contains an invalid questionNumber");
    }
    if (issue.page !== undefined && (!Number.isInteger(issue.page) || issue.page < 1)) {
      problems.push("semanticFidelityIssues contains an invalid page");
    }
  }

  return problems;
}

function deriveSubjects(data: ExtractedExamData): Record<string, number> {
  if (data.subjects) return { ...data.subjects };

  const subjects: Record<string, number> = {};
  for (const question of data.questions) {
    const subject = question.subject?.trim();
    if (!subject) continue;
    subjects[subject] = (subjects[subject] ?? 0) + 1;
  }
  return subjects;
}

function makeBlockedJob(
  adapter: IngestionAdapter,
  plan: IngestionPlan,
  jobKey: string,
  issue: IngestionEngineIssue,
): IngestionJobResult {
  return {
    jobKey,
    providerId: adapter.providerId,
    sourceId: adapter.sourceId,
    editionId: plan.editionId,
    year: plan.year,
    phase: plan.phase,
    variant: plan.variant,
    status: "blocked",
    rightsStatus: adapter.rightsStatus,
    statementMode: adapter.statementMode,
    engineIssues: [issue],
    report: null,
    stagedExam: null,
    documentsDiscovered: plan.documents.length,
    documentsFetched: 0,
    durationMs: 0,
  };
}

function inferPreliminaryKeyOnly(plan: IngestionPlan): boolean {
  const roles = new Set(plan.documents.map((document) => document.role));
  return roles.has("answer-key-preliminary") && !roles.has("answer-key");
}

function stagedCoverage(stagedExam: StagedImportedExam): {
  structurallyCompleteQuestions: number;
  contentReadyQuestions: number;
  semanticFidelityReadyQuestions: number;
  questionsNeedingFallback: number;
  questionsMissingMedia: number;
} {
  const missingMedia = new Set(stagedExam.questionsMissingMedia);
  const semanticIssues = assessSemanticFidelity({
    questions: stagedExam.questions,
    answerKey: {},
    semanticFidelityIssues: stagedExam.semanticFidelityIssues,
  });
  const needsFallback = new Set<number>(missingMedia);
  let structurallyCompleteQuestions = 0;
  let contentReadyQuestions = 0;
  let semanticFidelityReadyQuestions = 0;

  for (const question of stagedExam.questions) {
    const complete = questionHasCompleteStructure(question, stagedExam.allowedLetters);
    if (complete) {
      structurallyCompleteQuestions += 1;
      if (!missingMedia.has(question.number)) contentReadyQuestions += 1;
    } else {
      needsFallback.add(question.number);
    }

    const blockedBySemanticIssue = semanticIssues.some((issue) =>
      issueBlocksQuestion(issue, question),
    );
    if (!blockedBySemanticIssue) {
      semanticFidelityReadyQuestions += 1;
    } else {
      needsFallback.add(question.number);
    }
  }

  return {
    structurallyCompleteQuestions,
    contentReadyQuestions,
    semanticFidelityReadyQuestions,
    questionsNeedingFallback: needsFallback.size,
    questionsMissingMedia: missingMedia.size,
  };
}

function buildReviewQueue(jobs: readonly IngestionJobResult[]): IngestionReviewItem[] {
  return jobs
    .filter(
      (job): job is IngestionJobResult & { stagedExam: NonNullable<IngestionJobResult["stagedExam"]> } =>
        job.status === "ready-for-review" && job.stagedExam !== null,
    )
    .map((job) => {
      const coverage = stagedCoverage(job.stagedExam);
      const completeNativeContent =
        coverage.contentReadyQuestions === job.stagedExam.questions.length &&
        coverage.semanticFidelityReadyQuestions === job.stagedExam.questions.length;
      const reportWarnings =
        job.report?.issues.filter((issue) => !issue.fatal).map((issue) => issue.message) ?? [];
      const semanticWarnings = job.stagedExam.semanticFidelityIssues.map((issue) =>
        `fidelidade semântica${issue.questionNumber ? ` q${issue.questionNumber}` : ""}: ${issue.message}`,
      );

      return {
        jobKey: job.jobKey,
        providerId: job.providerId,
        sourceId: job.sourceId,
        editionId: job.editionId,
        year: job.year,
        phase: job.phase,
        variant: job.variant,
        questionCount: job.stagedExam.questions.length,
        structurallyCompleteQuestions: coverage.structurallyCompleteQuestions,
        contentReadyQuestions: coverage.contentReadyQuestions,
        semanticFidelityReadyQuestions: coverage.semanticFidelityReadyQuestions,
        questionsNeedingFallback: coverage.questionsNeedingFallback,
        questionsMissingMedia: coverage.questionsMissingMedia,
        rightsStatus: job.rightsStatus,
        nativeContentCandidate:
          job.rightsStatus === "allowed" &&
          job.statementMode !== "reference-only" &&
          completeNativeContent,
        fallback: job.stagedExam.fallback,
        semanticFidelityIssues: job.stagedExam.semanticFidelityIssues.map((issue) => ({ ...issue })),
        warnings: [
          ...new Set([...job.stagedExam.warnings, ...reportWarnings, ...semanticWarnings]),
        ],
      };
    });
}

async function processJob(
  job: PlannedJob,
  fetcher: DocumentFetcher,
  options: Required<Pick<IngestionEngineOptions, "now">> &
    Pick<IngestionEngineOptions, "previousFingerprints">,
): Promise<IngestionJobResult> {
  const { adapter, plan, jobKey } = job;
  const startedMs = options.now().getTime();
  const engineIssues: IngestionEngineIssue[] = [];
  const fetchedDocuments = [];

  for (const definition of plan.documents) {
    let fetched;
    try {
      fetched = await fetcher(definition.url);
    } catch (error) {
      engineIssues.push({
        code: "fetch-failed",
        stage: "fetch",
        message: `${definition.url}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    try {
      const fingerprint = await fingerprintFetchedDocument(
        fetched,
        adapter.importerVersion,
        options.now().toISOString(),
      );
      fetchedDocuments.push({ definition, fetched, fingerprint });
    } catch (error) {
      engineIssues.push({
        code: "fingerprint-failed",
        stage: "fingerprint",
        message: `${definition.url}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (engineIssues.length) {
    return {
      ...makeBlockedJob(adapter, plan, jobKey, engineIssues[0]),
      engineIssues,
      documentsFetched: fetchedDocuments.length,
      durationMs: Math.max(0, options.now().getTime() - startedMs),
    };
  }

  const extractionContext = { plan, documents: fetchedDocuments };
  let extracted: ExtractedExamData;
  try {
    extracted = await adapter.extract(extractionContext);
  } catch (error) {
    return {
      ...makeBlockedJob(adapter, plan, jobKey, {
        code: "extract-failed",
        stage: "extraction",
        message: error instanceof Error ? error.message : String(error),
      }),
      documentsFetched: fetchedDocuments.length,
      durationMs: Math.max(0, options.now().getTime() - startedMs),
    };
  }

  const extractionProblems = validateExtraction(extracted);
  if (extractionProblems.length) {
    return {
      ...makeBlockedJob(adapter, plan, jobKey, {
        code: "invalid-extraction",
        stage: "extraction",
        message: extractionProblems.join("; "),
      }),
      documentsFetched: fetchedDocuments.length,
      durationMs: Math.max(0, options.now().getTime() - startedMs),
    };
  }

  let fallback: IngestionFallbackSummary | undefined;
  const fallbackRequest = buildSelectiveFallbackRequest(extracted, plan.allowedLetters);
  if (fallbackRequest.targets.length && adapter.fallbackExtract) {
    try {
      const fallbackResult = await adapter.fallbackExtract(
        extractionContext,
        fallbackRequest,
        extracted,
      );
      if (!Array.isArray(fallbackResult.questions)) {
        throw new Error("fallback did not return a questions array");
      }
      extracted = mergeSelectiveFallback(extracted, fallbackResult, fallbackRequest);
      const mergedProblems = validateExtraction(extracted);
      if (mergedProblems.length) {
        throw new Error(mergedProblems.join("; "));
      }
      fallback = {
        targetCount: fallbackRequest.targets.length,
        replacedQuestions: [...new Set(fallbackResult.questions.map((question) => question.number))].sort(
          (a, b) => a - b,
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fallback = {
        targetCount: fallbackRequest.targets.length,
        replacedQuestions: [],
        failed: message,
      };
      extracted = {
        ...extracted,
        warnings: [...(extracted.warnings ?? []), `fallback seletivo falhou: ${message}`],
      };
    }
  }

  const semanticFidelityIssues = assessSemanticFidelity(extracted);
  const subjects = deriveSubjects(extracted);
  const annulled = [...new Set(extracted.annulled ?? [])].sort((a, b) => a - b);
  const questionsMissingMedia = [...new Set(extracted.questionsMissingMedia ?? [])].sort(
    (a, b) => a - b,
  );
  const changedDocuments = fetchedDocuments
    .filter(({ fingerprint }) => {
      const previous = options.previousFingerprints?.[fingerprint.url];
      return compareFingerprints(previous, fingerprint) === "changed";
    })
    .map(({ fingerprint }) => fingerprint.url);

  const raw: RawImportedExam = {
    providerId: adapter.providerId,
    sourceId: adapter.sourceId,
    editionId: plan.editionId,
    year: plan.year,
    phase: plan.phase,
    importerVersion: adapter.importerVersion,
    fingerprints: fetchedDocuments.map(({ fingerprint }) => fingerprint),
    parsedNumbers: extracted.questions.map((question) => question.number),
    answerKey: { ...extracted.answerKey },
    annulled,
    subjects,
    statementMode: adapter.statementMode,
    extractionMethod: adapter.extractionMethod,
    rightsStatus: adapter.rightsStatus,
  };

  const report = validateEdition({
    providerId: adapter.providerId,
    sourceId: adapter.sourceId,
    editionId: plan.editionId,
    importerVersion: adapter.importerVersion,
    parsedNumbers: raw.parsedNumbers,
    expectedCount: plan.expectedCount,
    answerKey: raw.answerKey,
    annulled,
    allowedLetters: [...plan.allowedLetters],
    subjects,
    documentsDiscovered: plan.documents.length,
    documentsFetched: fetchedDocuments.length,
    preliminaryKeyOnly: inferPreliminaryKeyOnly(plan),
    changedDocuments: changedDocuments.length ? changedDocuments : undefined,
    questionsMissingMedia,
  });

  return {
    jobKey,
    providerId: adapter.providerId,
    sourceId: adapter.sourceId,
    editionId: plan.editionId,
    year: plan.year,
    phase: plan.phase,
    variant: plan.variant,
    status: report.validation === "blocked" ? "blocked" : "ready-for-review",
    rightsStatus: adapter.rightsStatus,
    statementMode: adapter.statementMode,
    engineIssues: [],
    report,
    stagedExam: {
      raw,
      variant: plan.variant,
      allowedLetters: [...plan.allowedLetters],
      questions: extracted.questions.map((question) => ({
        ...question,
        alternatives: question.alternatives?.map((alternative) => ({ ...alternative })),
        files: question.files ? [...question.files] : undefined,
      })),
      questionsMissingMedia,
      semanticFidelityIssues: semanticFidelityIssues.map((issue) => ({ ...issue })),
      fallback,
      warnings: [...(extracted.warnings ?? [])],
    },
    documentsDiscovered: plan.documents.length,
    documentsFetched: fetchedDocuments.length,
    durationMs: Math.max(0, options.now().getTime() - startedMs),
  };
}

/**
 * Batch orchestrator for high-volume objective-exam ingestion.
 *
 * Success means "ready for human review", never "published". This keeps the
 * existing reviewed/verified and rights gates as the only path to native
 * runtime content while allowing discovery/download/extraction to scale.
 */
export class IngestionEngine {
  async run(
    adapters: readonly IngestionAdapter[],
    fetcher: DocumentFetcher,
    options: IngestionEngineOptions = {},
  ): Promise<IngestionRunResult> {
    const concurrency = options.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("ingestion concurrency must be a positive integer");
    }

    const now = options.now ?? (() => new Date());
    const startedAt = now().toISOString();
    const runId = options.runId ?? `ingestion-${startedAt.replace(/[^0-9]/g, "")}`;
    const sourceFailures: IngestionSourceFailure[] = [];
    const skippedEditions: SkippedEdition[] = [];
    const preblockedJobs: IngestionJobResult[] = [];
    const plannedJobs: PlannedJob[] = [];
    let editionsDiscovered = 0;

    for (const adapter of adapters) {
      if (adapter.discovery.sourceId !== adapter.sourceId) {
        sourceFailures.push({
          providerId: adapter.providerId,
          sourceId: adapter.sourceId,
          stage: "configuration",
          message: `adapter sourceId ${adapter.sourceId} does not match discovery sourceId ${adapter.discovery.sourceId}`,
        });
        continue;
      }

      let editions: DiscoveredEdition[];
      try {
        editions = await adapter.discovery.discover(fetcher);
      } catch (error) {
        sourceFailures.push({
          providerId: adapter.providerId,
          sourceId: adapter.sourceId,
          stage: "discovery",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      editionsDiscovered += editions.length;

      for (const edition of editions) {
        if (!adapter.discovery.isAllowed(edition)) {
          skippedEditions.push({
            providerId: adapter.providerId,
            sourceId: adapter.sourceId,
            editionId: edition.editionId,
            reason: "not-allowed",
          });
          continue;
        }

        let plans: IngestionPlan[];
        try {
          plans = await adapter.plan(edition);
        } catch (error) {
          sourceFailures.push({
            providerId: adapter.providerId,
            sourceId: adapter.sourceId,
            editionId: edition.editionId,
            stage: "planning",
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        for (const plan of plans) {
          const jobKey = buildIngestionJobKey(adapter.providerId, plan);
          const problems = validatePlan(plan, edition, adapter.statementMode);
          if (problems.length) {
            preblockedJobs.push(
              makeBlockedJob(adapter, plan, jobKey, {
                code: "invalid-plan",
                stage: "planning",
                message: problems.join("; "),
              }),
            );
            continue;
          }
          plannedJobs.push({ adapter, plan, jobKey });
        }
      }
    }

    const grouped = new Map<string, PlannedJob[]>();
    for (const job of plannedJobs) {
      const group = grouped.get(job.jobKey) ?? [];
      group.push(job);
      grouped.set(job.jobKey, group);
    }

    const runnableJobs: PlannedJob[] = [];
    const duplicateJobs: IngestionJobResult[] = [];
    for (const [jobKey, group] of grouped) {
      if (group.length === 1) {
        runnableJobs.push(group[0]);
        continue;
      }
      const first = group[0];
      duplicateJobs.push(
        makeBlockedJob(first.adapter, first.plan, jobKey, {
          code: "duplicate-job",
          stage: "planning",
          message: `${group.length} ingestion plans claim the same logical exam identity`,
        }),
      );
    }

    const processedJobs = await mapWithConcurrency(runnableJobs, concurrency, (job) =>
      processJob(job, fetcher, { now, previousFingerprints: options.previousFingerprints }),
    );
    const jobs = [...preblockedJobs, ...duplicateJobs, ...processedJobs].sort((a, b) =>
      a.jobKey.localeCompare(b.jobKey),
    );
    const reviewQueue = buildReviewQueue(jobs);
    const finishedAt = now().toISOString();
    const coverage = jobs.reduce(
      (total, job) => {
        if (!job.stagedExam) return total;
        const current = stagedCoverage(job.stagedExam);
        total.structurallyCompleteQuestions += current.structurallyCompleteQuestions;
        total.contentReadyQuestions += current.contentReadyQuestions;
        total.semanticFidelityReadyQuestions += current.semanticFidelityReadyQuestions;
        total.questionsNeedingFallback += current.questionsNeedingFallback;
        total.questionsMissingMedia += current.questionsMissingMedia;
        return total;
      },
      {
        structurallyCompleteQuestions: 0,
        contentReadyQuestions: 0,
        semanticFidelityReadyQuestions: 0,
        questionsNeedingFallback: 0,
        questionsMissingMedia: 0,
      },
    );

    return {
      runId,
      startedAt,
      finishedAt,
      jobs,
      reviewQueue,
      sourceFailures,
      skippedEditions,
      summary: {
        sources: adapters.length,
        editionsDiscovered,
        jobsPlanned: jobs.length,
        readyForReview: jobs.filter((job) => job.status === "ready-for-review").length,
        blocked: jobs.filter((job) => job.status === "blocked").length,
        skippedNotAllowed: skippedEditions.length,
        documentsFetched: jobs.reduce((total, job) => total + job.documentsFetched, 0),
        questionsExtracted: jobs.reduce(
          (total, job) => total + (job.stagedExam?.questions.length ?? 0),
          0,
        ),
        ...coverage,
        fallbackAttempts: jobs.filter((job) => job.stagedExam?.fallback).length,
        fallbackReplacements: jobs.reduce(
          (total, job) => total + (job.stagedExam?.fallback?.replacedQuestions.length ?? 0),
          0,
        ),
      },
    };
  }
}
