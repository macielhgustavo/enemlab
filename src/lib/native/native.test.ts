import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  applyNativeBundle,
  nativeManifestSchema,
  nativeCoverage,
  type NativeBundle,
} from "./bundle";
import { createNativeLoader } from "./loader";
import { itaFirstPhaseQuestions } from "../providers/ita";
import { toLegacyQuestion } from "../providers/legacy";
import { questionKey } from "../domain/classify";
import manifest from "../../../public/native/manifest.json";
import { withNativeCoverage } from "./catalog";
import { getProvider } from "../providers";
import { richText, safeUrl, markdownImageUrls } from "../format";

function fixture(): NativeBundle {
  const base = itaFirstPhaseQuestions(2025)[0];
  return {
    schemaVersion: 1,
    providerId: base.providerId,
    year: base.year,
    editionId: null,
    questions: [
      {
        providerId: base.providerId,
        examId: base.examId,
        editionId: null,
        year: base.year,
        number: base.number!,
        phase: base.phase,
        language: base.language,
        statement: "Questão sintética de teste: calcule $2 + 2$.",
        context: "Contexto sintético para testar o resolvedor.",
        alternatives: base.alternatives.map((alternative) => ({
          letter: alternative.letter,
          text: `Opção sintética ${alternative.letter}`,
        })),
        validationLevel: "reviewed",
        provenance: {
          documentUrl: base.official!.documentUrl,
          documentSha256: "a".repeat(64),
          parserVersion: "test-only@1",
          extractionMethod: "manual",
          rightsStatus: "allowed",
          rightsEvidenceUrl: "https://example.org/test-only",
          reviewedBy: "Automated fixture, not a real question",
          reviewedAt: "2026-09-10T12:00:00Z",
          revision: "final",
        },
      },
    ],
  };
}

function download(bundle = fixture()) {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("TextDecoder", TextDecoder);
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const index = {
    schemaVersion: 1,
    entries: [
      {
        providerId: bundle.providerId,
        year: bundle.year,
        editionId: bundle.editionId,
        questionCount: bundle.questions.length,
        path: `/native/editions/${sha256}.json`,
        sha256,
        coverage: nativeCoverage(bundle),
      },
    ],
  };
  const request = vi.fn(
    async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }) as Response,
  );
  return { index, request, load: createNativeLoader(index, request) };
}

afterEach(() => vi.unstubAllGlobals());

describe("native publication gate", () => {
  it("delivers the statement to the runner and preserves correction, classification and history keys", () => {
    const base = itaFirstPhaseQuestions(2025);
    const enriched = applyNativeBundle(base, fixture());
    const original = toLegacyQuestion(base[0]);
    const native = toLegacyQuestion(enriched[0]);
    expect(native.context).toContain("calcule $2 + 2$");
    expect(native.context).toContain("Contexto sintético");
    expect(native.statementAvailable).toBe(true);
    expect(native.alternatives?.every((alternative) => alternative.text)).toBe(true);
    expect(enriched[0].content).toBe(base[0].content);
    expect(native.correctAlternative).toBe(original.correctAlternative);
    expect(native.alternatives?.map((alternative) => alternative.isCorrect)).toEqual(
      original.alternatives?.map((alternative) => alternative.isCorrect),
    );
    expect(questionKey(native)).toBe(questionKey(original));
    expect(enriched[1]).toBe(base[1]);
    expect(applyNativeBundle(enriched, fixture())).toEqual(enriched);
    expect(base[0].statementAvailable).toBe(false);
  });

  it.each(["providerId", "examId", "editionId", "language", "phase", "number"] as const)(
    "rejects mismatched %s",
    (field) => {
      const bundle = fixture();
      Object.assign(bundle.questions[0], {
        [field]: field === "number" ? 999 : field === "phase" ? "second" : "different",
      });
      expect(() => applyNativeBundle(itaFirstPhaseQuestions(2025), bundle)).toThrow();
    },
  );

  it("rejects duplicates and leaves the entire reference edition unchanged", () => {
    const bundle = fixture();
    bundle.questions.push(bundle.questions[0]);
    const base = itaFirstPhaseQuestions(2025);
    expect(() => applyNativeBundle(base, bundle)).toThrow(/Duplicate/);
    expect(base.every((question) => question.statementAvailable === false)).toBe(true);
  });

  it("refuses a different booklet even when numbering and alternatives match", () => {
    const bundle = fixture();
    bundle.questions[0].provenance.documentUrl = "https://example.org/other-variant.pdf";
    expect(() => applyNativeBundle(itaFirstPhaseQuestions(2025), bundle)).toThrow(
      /document\/variant/,
    );
  });

  it.each([
    { rightsStatus: "permission-required" },
    { revision: "preliminary" },
    { documentSha256: "invalid" },
    { reviewedBy: "" },
    { rightsEvidenceUrl: "" },
  ])("rejects incomplete review evidence: %j", (invalid) => {
    const bundle = fixture();
    Object.assign(bundle.questions[0].provenance, invalid);
    expect(() => applyNativeBundle(itaFirstPhaseQuestions(2025), bundle)).toThrow();
  });

  it("rejects answer injection, missing alternatives and unsafe media", () => {
    const bundle = fixture();
    expect(() =>
      applyNativeBundle(itaFirstPhaseQuestions(2025), {
        ...bundle,
        questions: [{ ...bundle.questions[0], correctAlternative: "B" }],
      }),
    ).toThrow();
    bundle.questions[0].alternatives.pop();
    expect(() => applyNativeBundle(itaFirstPhaseQuestions(2025), bundle)).toThrow(
      /alternative set/,
    );
    const unsafe = fixture();
    unsafe.questions[0].files = ["javascript:alert(1)"];
    expect(() => applyNativeBundle(itaFirstPhaseQuestions(2025), unsafe)).toThrow();
  });

  it("preserves annulled questions without inventing an answer", () => {
    const base = itaFirstPhaseQuestions(2025);
    base[0].correctAlternative = null;
    base[0].alternatives.forEach((alternative) => {
      alternative.isCorrect = false;
    });
    const result = applyNativeBundle(base, fixture())[0];
    expect(result.correctAlternative).toBeNull();
    expect(result.alternatives.some((alternative) => alternative.isCorrect)).toBe(false);
  });
});

describe("lazy native edition loading", () => {
  it("does not download anything for editions without native content", async () => {
    const { load, request } = download();
    const questions = itaFirstPhaseQuestions(2026);
    expect(await load("ita", { year: 2026 }, questions)).toBe(questions);
    expect(request).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent downloads, isolates returned content, and supports forced refresh", async () => {
    const { load, request } = download();
    const base = itaFirstPhaseQuestions(2025);
    const [first, second] = await Promise.all([
      load("ita", { year: 2025 }, base),
      load("ita", { year: 2025 }, base),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    first[0].alternatives[0].text = "mutated";
    expect(second[0].alternatives[0].text).not.toBe("mutated");
    await load("ita", { year: 2025, force: true }, base);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects changed bytes and permits a retry after failure", async () => {
    const { load, request } = download();
    request.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);
    await expect(load("ita", { year: 2025 }, itaFirstPhaseQuestions(2025))).rejects.toThrow(
      /checksum/,
    );
    await expect(
      load("ita", { year: 2025 }, itaFirstPhaseQuestions(2025)),
    ).resolves.toBeDefined();
  });

  it("rejects HTTP errors, count mismatches and duplicate manifest entries", async () => {
    const { index, request, load } = download();
    request.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    await expect(load("ita", { year: 2025 }, itaFirstPhaseQuestions(2025))).rejects.toThrow(
      /404/,
    );
    index.entries[0].questionCount++;
    index.entries[0].coverage.first++;
    await expect(
      createNativeLoader(index, request)("ita", { year: 2025 }, itaFirstPhaseQuestions(2025)),
    ).rejects.toThrow(/manifest mismatch/);
    index.entries.push(index.entries[0]);
    expect(() => createNativeLoader(index, request)).toThrow(/Duplicate/);
  });
});

it("verifies every committed native file against its provider without network access", async () => {
  const index = nativeManifestSchema.parse(manifest);
  for (const entry of index.entries) {
    const bytes = readFileSync(path.join(process.cwd(), "public", entry.path));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    expect(entry.providerId).not.toBe("enem");
    const base = await getProvider(entry.providerId).fetchQuestions({
      year: entry.year,
      editionId: entry.editionId ?? undefined,
      nativeContent: false,
    });
    const bundle = JSON.parse(bytes.toString("utf8"));
    expect(bundle.questions).toHaveLength(entry.questionCount);
    expect(nativeCoverage(bundle)).toEqual(entry.coverage);
    expect(() => applyNativeBundle(base, bundle)).not.toThrow();
  }
});

it("distinguishes partial native coverage from a fully native edition without loading questions", () => {
  const { index } = download();
  const entry = {
    providerId: "ita",
    editionId: "2025",
    year: 2025,
    phase: "first",
    questionCount: 60,
    subjects: {},
    validation: "reviewed" as const,
    sourceId: "ita",
    statementAvailable: false,
    importerVersion: "1",
  };
  const native = nativeManifestSchema.parse(index);
  expect(withNativeCoverage(entry, native)).toMatchObject({
    nativeQuestionCount: 1,
    contentMode: "hybrid",
    statementAvailable: false,
  });
  expect(withNativeCoverage({ ...entry, questionCount: 1 }, native)).toMatchObject({
    contentMode: "structured",
    statementAvailable: true,
  });
  expect(
    withNativeCoverage({ ...entry, providerId: "ime" }, native).nativeQuestionCount,
  ).toBeUndefined();
});

it("renders local native media safely, including images embedded in the statement", () => {
  const markdown = "Observe ![Diagrama](/native/assets/ita/diagram.svg)";
  expect(richText(markdown)).toContain('src="/native/assets/ita/diagram.svg"');
  expect(markdownImageUrls(markdown)).toEqual(["/native/assets/ita/diagram.svg"]);
  for (const unsafe of [
    "/native/assets/../secret",
    "//evil.example/image.svg",
    "/native/assets/%2e%2e/secret",
    "javascript:alert(1)",
  ]) {
    expect(safeUrl(unsafe)).toBe("");
  }
});

it("validates a candidate through the real CLI without publishing it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "enemlab-native-"));
  const file = path.join(directory, "candidate.json");
  const before = readFileSync("public/native/manifest.json", "utf8");
  try {
    await writeFile(file, JSON.stringify(fixture()));
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["scripts/native-content.mjs", file],
      { cwd: process.cwd() },
    );
    expect(stdout).toContain('"status":"validated"');
    expect(readFileSync("public/native/manifest.json", "utf8")).toBe(before);
  } finally {
    await unlink(file);
    await rmdir(directory);
  }
}, 30000);
