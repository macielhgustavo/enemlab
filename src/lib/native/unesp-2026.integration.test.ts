import { describe, expect, it } from "vitest";
import { questionKey } from "../domain/classify";
import { toLegacyQuestion } from "../providers/legacy";
import { unespFirstPhaseQuestions } from "../providers/unesp";
import type { NativePack, NativeQuestionContentRecord } from "./contracts";
import { applyNativePackToQuestions } from "./loader";

const SOURCE_SHA = "fda4e93aa4b1db96dd07fca3905fd7a254262087da5ddfd44b0f26f742a8a8d0";
const ROOT = `native/unesp/2026/first/${SOURCE_SHA.slice(0, 16)}`;

function recordFor(number: number): NativeQuestionContentRecord {
  const visualRegions: NativeQuestionContentRecord["visualRegions"] = [
    {
      page: Math.max(1, Math.ceil(number / 3)),
      role: "question",
      rect: { x: 0.05, y: 0.05, width: 0.42, height: 0.4 },
      assetPath: `${ROOT}/questions/q-${String(number).padStart(3, "0")}-r0-test.webp`,
    },
  ];

  if (number === 16) {
    visualRegions.push({
      page: 7,
      role: "continuation",
      rect: { x: 0.505, y: 0.025, width: 0.43, height: 0.5 },
      assetPath: `${ROOT}/questions/q-016-r1-test.webp`,
    });
  }

  return {
    questionKey: `unesp-2026-first-${number}`,
    providerId: "unesp",
    year: 2026,
    phase: "first",
    number,
    documentId: "unesp-2026-first",
    visualRegions,
    semantic: { rawText: "" },
    extraction: {
      method: "text-layer",
      parserVersion: "integration-test",
      confidence: 1,
      markerDetected: true,
      optionIdsDetected: ["A", "B", "C", "D", "E"],
      issues: number === 16 ? ["alternativas semânticas incompletas; visual canônico"] : [],
    },
    status: "published",
  };
}

function publishedPack(): NativePack {
  return {
    version: 1,
    createdAt: "2026-09-15T11:20:54.280Z",
    documents: [
      {
        documentId: "unesp-2026-first",
        providerId: "unesp",
        year: 2026,
        phase: "first",
        sourceUrl: "https://www.vunesp.com.br/",
        sourceSha256: SOURCE_SHA,
        sourceBytes: 4_018_639,
        pageCount: 40,
        pageAssetPattern: `${ROOT}/pages/page-{page:03d}.webp`,
        renderScale: 1.5,
        imageFormat: "webp",
      },
    ],
    questions: Array.from({ length: 90 }, (_, index) => recordFor(index + 1)),
  };
}

function signedUrls(pack: NativePack): Map<string, string> {
  const entries = pack.questions.flatMap((question) =>
    question.visualRegions.flatMap((region) =>
      region.assetPath ? [[region.assetPath, `https://signed.example.com/${region.assetPath}`] as const] : [],
    ),
  );
  return new Map(entries);
}

describe("UNESP 2026 NativePack -> runner", () => {
  it("casa as 90 identidades do provider e preserva o gabarito oficial", () => {
    const providerQuestions = unespFirstPhaseQuestions(2026).map(toLegacyQuestion);
    const pack = publishedPack();
    const nativeQuestions = applyNativePackToQuestions(providerQuestions, pack, signedUrls(pack));

    expect(providerQuestions).toHaveLength(90);
    expect(nativeQuestions).toHaveLength(90);
    expect(providerQuestions.map(questionKey)).toEqual(
      Array.from({ length: 90 }, (_, index) => `unesp-2026-first-${index + 1}`),
    );

    for (let index = 0; index < 90; index += 1) {
      const before = providerQuestions[index];
      const after = nativeQuestions[index];
      expect(after.statementAvailable).toBe(true);
      expect(after.correctAlternative).toBe(before.correctAlternative);
      expect(after.alternatives?.find((alternative) => alternative.isCorrect)?.letter).toBe(
        before.alternatives?.find((alternative) => alternative.isCorrect)?.letter,
      );
      expect(after.files?.[0]).toContain(`/q-${String(index + 1).padStart(3, "0")}-r0-test.webp`);
    }
  });

  it("entrega as duas regiões da questão 16 ao runner, na ordem correta", () => {
    const providerQuestions = unespFirstPhaseQuestions(2026).map(toLegacyQuestion);
    const pack = publishedPack();
    const nativeQuestions = applyNativePackToQuestions(providerQuestions, pack, signedUrls(pack));
    const q16 = nativeQuestions[15];

    expect(questionKey(q16)).toBe("unesp-2026-first-16");
    expect(q16.files?.slice(0, 2)).toEqual([
      expect.stringContaining("/q-016-r0-test.webp"),
      expect.stringContaining("/q-016-r1-test.webp"),
    ]);
  });

  it("faz fail-closed só na questão 16 se a segunda região estiver ausente", () => {
    const providerQuestions = unespFirstPhaseQuestions(2026).map(toLegacyQuestion);
    const pack = publishedPack();
    const urls = signedUrls(pack);
    urls.delete(`${ROOT}/questions/q-016-r1-test.webp`);

    const nativeQuestions = applyNativePackToQuestions(providerQuestions, pack, urls);

    expect(nativeQuestions[15]).toBe(providerQuestions[15]);
    expect(nativeQuestions[14]).not.toBe(providerQuestions[14]);
    expect(nativeQuestions[16]).not.toBe(providerQuestions[16]);
  });
});
