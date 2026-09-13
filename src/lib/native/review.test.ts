import { describe, expect, it } from "vitest";
import type { NativePack } from "./contracts";
import {
  approveAllStructurallyValid,
  approveNativeQuestion,
  nativePackGate,
  nativePageFilename,
  parseNativePackJson,
  updateNativeQuestionRect,
} from "./review";

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
        pageAssetPattern: "native/unesp/2026/first/page-{page:03d}.webp",
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
          },
        ],
        semantic: { rawText: "Questão 1" },
        extraction: {
          method: "text-layer",
          parserVersion: "native-pipeline@1.0.0",
          confidence: 0.9,
          markerDetected: true,
          optionIdsDetected: ["A", "B", "C", "D", "E"],
          issues: [],
        },
        status: "review",
      },
    ],
  };
}

describe("NativePack review", () => {
  it("parseia pack e recusa chaves duplicadas", () => {
    expect(parseNativePackJson(JSON.stringify(pack())).questions).toHaveLength(1);
    const invalid = pack();
    invalid.questions.push({ ...invalid.questions[0] });
    expect(() => parseNativePackJson(JSON.stringify(invalid))).toThrow(/duplicada/);
  });

  it("edita recorte e volta o status para review", () => {
    const approved = approveNativeQuestion(pack(), "unesp-2026-first-1");
    const edited = updateNativeQuestionRect(approved, "unesp-2026-first-1", 0, {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.2,
    });
    expect(edited.questions[0].status).toBe("review");
    expect(edited.questions[0].visualRegions[0].rect.x).toBe(0.1);
  });

  it("só libera publicação depois da aprovação humana", () => {
    expect(nativePackGate(pack()).publishable).toBe(false);
    const approved = approveAllStructurallyValid(pack());
    expect(nativePackGate(approved)).toMatchObject({ publishable: true, published: 1, total: 1 });
  });

  it("formata o padrão de página usado pelo storage", () => {
    expect(nativePageFilename("native/x/page-{page:03d}.webp", 7)).toBe("page-007.webp");
  });
});
