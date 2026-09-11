import manifest from "../../../public/native/manifest.json";
import {
  applyNativeBundle,
  editionKey,
  nativeBundleSchema,
  nativeManifestSchema,
  nativeCoverage,
} from "./bundle";
import type { FetchQuestionsParams, NormalizedQuestion } from "../providers/types";

export function createNativeLoader(
  input: unknown,
  request: typeof fetch = (...args) => fetch(...args),
) {
  const index = nativeManifestSchema.parse(input);
  const cache = new Map<string, Promise<unknown>>();

  return async (
    providerId: string,
    params: FetchQuestionsParams,
    questions: NormalizedQuestion[],
  ) => {
    const entry = index.entries.find(
      (item) =>
        item.providerId === providerId &&
        questions.some((question) => editionKey(item) === editionKey(question)),
    );
    if (!entry) return questions;
    if (params.force) cache.delete(entry.path);
    let pending = cache.get(entry.path);
    if (!pending) {
      pending = (async () => {
        const response = await request(entry.path, {
          cache: params.force ? "reload" : "default",
        });
        if (!response.ok)
          throw new Error(`Native content download failed (${response.status})`);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const checksum = Array.from(new Uint8Array(digest), (value) =>
          value.toString(16).padStart(2, "0"),
        ).join("");
        if (checksum !== entry.sha256) throw new Error("Native content checksum mismatch");
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      })();
      cache.set(entry.path, pending);
    }
    try {
      const payload = await pending;
      const bundle = nativeBundleSchema.parse(payload);
      if (
        editionKey(bundle) !== editionKey(entry) ||
        bundle.questions.length !== entry.questionCount
      ) {
        throw new Error("Native content manifest mismatch");
      }
      const coverage = nativeCoverage(bundle);
      if (Object.entries(entry.coverage).some(([phase, count]) => coverage[phase] !== count)) {
        throw new Error("Native content coverage mismatch");
      }
      return applyNativeBundle(questions, bundle);
    } catch (error) {
      if (cache.get(entry.path) === pending) cache.delete(entry.path);
      throw error;
    }
  };
}

export const loadNativeQuestions = createNativeLoader(manifest);
