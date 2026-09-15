import { describe, expect, it } from "vitest";
import type { Question } from "../domain/types";
import { nativePageAssetPath } from "./cloud";
import type { NativePack } from "./contracts";
import { applyNativePackToQuestions, nativeVisualPaths } from "./loader";

function baseQuestion(): Question {
  return {
    providerId: "unesp",
    year: 2026,
    phase: "first",
    index: 1,
    number: 1,
    discipline: "linguagens",
    statementAvailable: false,
    alternatives: ["A", "B", "C", "D", "E"].map((letter) => ({
      letter,
      text: "",
      isCorrect: letter === "C",
    })),
    correctAlternative: "C",
    files: [],
    official: {
      official: false,
      institution: "VUNESP",
      documentUrl: "https://example.com/prova.pdf",
    },
  };
}

function pack(): NativePack {
  return {
    version: 1,
    createdAt: "2026-09-13T22:00:00.000Z",
    documents: [
      {
        documentId: "unesp-2026-first",
        providerId: "unesp",
        year: 2026,
        phase: "first",
        sourceUrl: "https://example.com/prova.pdf",
        sourceSha256: "a".repeat(64),
        sourceBytes: 1000,
        pageCount: 40,
        pageAssetPattern: "native/unesp/2026/first/aaaaaaaaaaaaaaaa/pages/page-{page:03d}.webp",
        renderScale: 1.5,
        imageFormat: "webp",
      },
    ],
    questions: [
      {
        questionKey: "unesp-2026-first-1",
        providerId: "unesp",
        year: 2026,
        phase: "first",
        number: 1,
        documentId: "unesp-2026-first",
        visualRegions: [
          {
            page: 3,
            role: "question",
            rect: { x: 0.05, y: 0.1, width: 0.4, height: 0.25 },
            assetPath: "native/unesp/2026/first/aaaaaaaaaaaaaaaa/questions/q-001-r0-a.webp",
          },
        ],
        semantic: { rawText: "texto extraído" },
        extraction: {
          method: "text-layer",
          parserVersion: "native-pipeline@2.0.0",
          confidence: 1,
          markerDetected: true,
          optionIdsDetected: ["A", "B", "C", "D", "E"],
          issues: [],
          visualCompleteness: {
            required: false,
            resolved: true,
            reasons: [],
            strategy: "not-required",
          },
        },
        status: "published",
      },
    ],
  };
}

describe("NativePack loader", () => {
  it("torna a questão nativa sem tocar no gabarito do provider", () => {
    const question = baseQuestion();
    const path = pack().questions[0].visualRegions[0].assetPath!;
    const result = applyNativePackToQuestions(
      [question],
      pack(),
      new Map([[path, "https://signed.example.com/q1.webp"]]),
    )[0];

    expect(result.statementAvailable).toBe(true);
    expect(result.files).toContain("https://signed.example.com/q1.webp");
    expect(result.correctAlternative).toBe("C");
    expect(result.alternatives?.find((alternative) => alternative.isCorrect)?.letter).toBe("C");
  });

  it("mantém modo referência se o visual assinado não estiver disponível", () => {
    const question = baseQuestion();
    const result = applyNativePackToQuestions([question], pack(), new Map())[0];
    expect(result).toBe(question);
    expect(result.statementAvailable).toBe(false);
  });

  it("exige todas as regiões de uma questão multi-região", () => {
    const multi = pack();
    const secondPath = "native/unesp/2026/first/aaaaaaaaaaaaaaaa/questions/q-001-r1-b.webp";
    multi.questions[0].visualRegions.push({
      page: 3,
      role: "continuation",
      rect: { x: 0.52, y: 0.08, width: 0.42, height: 0.35 },
      assetPath: secondPath,
    });
    const firstPath = multi.questions[0].visualRegions[0].assetPath!;
    const question = baseQuestion();

    const incomplete = applyNativePackToQuestions(
      [question],
      multi,
      new Map([[firstPath, "https://signed.example.com/q1-r0.webp"]]),
    )[0];
    expect(incomplete).toBe(question);

    const complete = applyNativePackToQuestions(
      [question],
      multi,
      new Map([
        [firstPath, "https://signed.example.com/q1-r0.webp"],
        [secondPath, "https://signed.example.com/q1-r1.webp"],
      ]),
    )[0];
    expect(complete).not.toBe(question);
    expect(complete.files?.slice(0, 2)).toEqual([
      "https://signed.example.com/q1-r0.webp",
      "https://signed.example.com/q1-r1.webp",
    ]);
  });

  it("cai para referência se qualquer região publicada não tiver assetPath", () => {
    const invalid = pack();
    invalid.questions[0].visualRegions.push({
      page: 3,
      role: "continuation",
      rect: { x: 0.52, y: 0.08, width: 0.42, height: 0.35 },
    });
    const firstPath = invalid.questions[0].visualRegions[0].assetPath!;
    const question = baseQuestion();
    expect(
      applyNativePackToQuestions(
        [question],
        invalid,
        new Map([[firstPath, "https://signed.example.com/q1-r0.webp"]]),
      )[0],
    ).toBe(question);
  });

  it("recusa metadata de identidade divergente mesmo quando questionKey coincide", () => {
    const corrupt = pack();
    corrupt.questions[0].number = 2;
    const path = corrupt.questions[0].visualRegions[0].assetPath!;
    const question = baseQuestion();
    expect(
      applyNativePackToQuestions(
        [question],
        corrupt,
        new Map([[path, "https://signed.example.com/q1.webp"]]),
      )[0],
    ).toBe(question);
  });

  it("recusa editionId divergente mesmo quando questionKey coincide", () => {
    const corrupt = pack();
    corrupt.questions[0].editionId = "v1";
    const path = corrupt.questions[0].visualRegions[0].assetPath!;
    const question = baseQuestion();
    expect(
      applyNativePackToQuestions(
        [question],
        corrupt,
        new Map([[path, "https://signed.example.com/q1.webp"]]),
      )[0],
    ).toBe(question);
  });

  it("ignora registros em review ou apenas approved", () => {
    for (const status of ["review", "approved"] as const) {
      const pending = pack();
      pending.questions[0].status = status;
      const path = pending.questions[0].visualRegions[0].assetPath!;
      const question = baseQuestion();
      expect(
        applyNativePackToQuestions(
          [question],
          pending,
          new Map([[path, "https://signed.example.com/q1.webp"]]),
        )[0],
      ).toBe(question);
    }
  });

  it("pack legado v1 usa página inteira e acrescenta página anterior quando o texto referencia contexto", () => {
    const legacy = pack();
    legacy.questions[0].extraction.parserVersion = "native-pipeline@1.0.0";
    delete legacy.questions[0].extraction.visualCompleteness;
    legacy.questions[0].semantic.rawText =
      "Depreende-se do início do romance ilustrado que a viagem de Nhô Quim à Corte se deve";

    const page2 = nativePageAssetPath(legacy.documents[0].pageAssetPattern, 2);
    const page3 = nativePageAssetPath(legacy.documents[0].pageAssetPattern, 3);
    expect(nativeVisualPaths(legacy.questions[0], legacy)).toEqual([page2, page3]);

    const question = baseQuestion();
    const result = applyNativePackToQuestions(
      [question],
      legacy,
      new Map([
        [page2, "https://signed.example.com/page-002.webp"],
        [page3, "https://signed.example.com/page-003.webp"],
      ]),
    )[0];
    expect(result.files?.slice(0, 2)).toEqual([
      "https://signed.example.com/page-002.webp",
      "https://signed.example.com/page-003.webp",
    ]);
    expect(result.correctAlternative).toBe("C");
  });

  it("pack legado falha fechado se uma das páginas de contexto não puder ser assinada", () => {
    const legacy = pack();
    legacy.questions[0].extraction.parserVersion = "native-pipeline@1.0.0";
    delete legacy.questions[0].extraction.visualCompleteness;
    legacy.questions[0].semantic.rawText = "Leia o trecho do romance e responda";
    const page3 = nativePageAssetPath(legacy.documents[0].pageAssetPattern, 3);

    const question = baseQuestion();
    const result = applyNativePackToQuestions(
      [question],
      legacy,
      new Map([[page3, "https://signed.example.com/page-003.webp"]]),
    )[0];
    expect(result).toBe(question);
  });
});
