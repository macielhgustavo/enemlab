import manifest from "../../../public/native/manifest.json";
import type { CatalogEntry } from "../catalog";
import { nativeManifestSchema, type NativeManifest } from "./bundle";

const index = nativeManifestSchema.parse(manifest);

export function withNativeCoverage(
  entry: CatalogEntry,
  native: NativeManifest = index,
): CatalogEntry {
  const edition = native.entries.find(
    (item) =>
      item.providerId === entry.providerId &&
      item.year === entry.year &&
      (item.editionId ?? String(item.year)) === entry.editionId,
  );
  if (!edition) return entry;
  const count = edition.coverage[entry.phase as keyof typeof edition.coverage] ?? 0;
  if (!count) return entry;
  if (entry.questionCount !== null && count > entry.questionCount)
    throw new Error("Native coverage exceeds catalog size");
  const complete = count === entry.questionCount;
  return {
    ...entry,
    nativeQuestionCount: count,
    contentMode: complete ? "structured" : "hybrid",
    statementAvailable: complete,
  };
}
