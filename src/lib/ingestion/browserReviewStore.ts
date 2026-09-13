import type { IngestionReviewDecision, ReviewDecisionStore } from "./review";

const STORAGE_KEY = "studium_ingestion_review_decisions_v1";

type StoredReviewDecisions = Record<string, IngestionReviewDecision>;

function readAll(): StoredReviewDecisions {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as StoredReviewDecisions;
  } catch {
    return {};
  }
}

function writeAll(value: StoredReviewDecisions): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

/**
 * Local-first persistence for the two-user review console.
 *
 * Decisions are also exportable as JSON from the console; localStorage is a
 * convenience cache, not the canonical publication record.
 */
export class BrowserReviewDecisionStore implements ReviewDecisionStore {
  async get(jobKey: string): Promise<IngestionReviewDecision | null> {
    const value = readAll()[jobKey];
    return value ? { ...value } : null;
  }

  async set(decision: IngestionReviewDecision): Promise<void> {
    const all = readAll();
    all[decision.jobKey] = { ...decision };
    writeAll(all);
  }

  list(): IngestionReviewDecision[] {
    return Object.values(readAll()).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  }
}

export const REVIEW_DECISION_STORAGE_KEY = STORAGE_KEY;
