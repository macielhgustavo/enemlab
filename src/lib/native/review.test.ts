import { describe, expect, it } from "vitest";
import type { NativePack } from "./contracts";
import {
  addNativeQuestionRegion,
  approveAllStructurallyValid,
  approveNativeQuestion,
  markNativePackPublished,
  nativePackGate,
  nativePageFilename,
  parseNativePackJson,
  removeNativeQuestionRegion,
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

  it("recusa status fora do lifecycle suportado", () => {
    const invalid = pack() as NativePack & { questions: Array<NativePack["questions"][number] & { status: string }> };
    invalid.questions[0].status = "done";
    expect(() => parseNativePackJson(JSON.stringify(invalid))).toThrow(/status inválido/);
  });

  it("aprova localmente sem fingir que a questão já foi publicada", () => {
    const approved = approveNativeQuestion(pack(), "unesp-2026-first-1");
    expect(approved.questions[0].status).toBe("approved");
    expect(nativePackGate(approved)).toMatchObject({ publishable: true, published: 1, total: 1 });
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

  it("adiciona e remove regiões sem permitir questão visualmente vazia", () => {
    const approved = approveNativeQuestion(pack(), "unesp-2026-first-1");
    const withContinuation = addNativeQuestionRegion(approved, "unesp-2026-first-1", {
      page: 3,
      role: "continuation",
      rect: { x: 0.52, y: 0.08, width: 0.42, height: 0.35 },
    });
    expect(withContinuation.questions[0].status).toBe("review");
    expect(withContinuation.questions[0].visualRegions).toHaveLength(2);

    const removed = removeNativeQuestionRegion(withContinuation, "unesp-2026-first-1", 1);
    expect(removed.questions[0].visualRegions).toHaveLength(1);
    expect(() => removeNativeQuestionRegion(removed, "unesp-2026-first-1", 0)).toThrow(/ao menos uma/);
  });

  it("só libera publicação depois da aprovação humana", () => {
    expect(nativePackGate(pack()).publishable).toBe(false);
    const approved = approveAllStructurallyValid(pack());
    expect(approved.questions[0].status).toBe("approved");
    expect(nativePackGate(approved)).toMatchObject({ publishable: true, published: 1, total: 1 });
  });

  it("marca published somente na transição explícita de publicação", () => {
    const approved = approveAllStructurallyValid(pack());
    const published = markNativePackPublished(approved);
    expect(published.questions[0].status).toBe("published");
    expect(approved.questions[0].status).toBe("approved");
    expect(() => markNativePackPublished(pack())).toThrow(/ainda não pode ser marcado/);
  });

  it("formata o padrão de página usado pelo storage", () => {
    expect(nativePageFilename("native/x/page-{page:03d}.webp", 7)).toBe("page-007.webp");
  });
});
