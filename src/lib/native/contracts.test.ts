import { describe, expect, it } from "vitest";
import {
  nativePublicationGate,
  type NativeDocumentRecord,
  type NativeQuestionContentRecord,
} from "./contracts";

const document: NativeDocumentRecord = {
  documentId: "unesp-2026-first",
  providerId: "unesp",
  year: 2026,
  phase: "first",
  sourceUrl: "https://example.test/prova.pdf",
  sourceSha256: "a".repeat(64),
  sourceBytes: 1_000,
  pageCount: 40,
  pageAssetPattern: "native/unesp/2026/first/page-{page}.webp",
  renderScale: 1.5,
  imageFormat: "webp",
};

const question: NativeQuestionContentRecord = {
  questionKey: "unesp-2026-first-1",
  providerId: "unesp",
  year: 2026,
  phase: "first",
  number: 1,
  documentId: document.documentId,
  visualRegions: [
    {
      page: 3,
      role: "question",
      rect: { x: 0.08, y: 0.04, width: 0.4, height: 0.4 },
    },
  ],
  semantic: { rawText: "texto semântico" },
  extraction: {
    method: "text-layer",
    parserVersion: "native-pipeline@1",
    confidence: 1,
    markerDetected: true,
    optionIdsDetected: ["A", "B", "C", "D", "E"],
    issues: [],
  },
  status: "review",
};

describe("nativePublicationGate", () => {
  it("aceita visual legado fiel mesmo sem evidência v2", () => {
    expect(nativePublicationGate(question, document)).toEqual({ publishable: true, issues: [] });
  });

  it("falha fechado sem documento ou com recorte fora da página", () => {
    expect(nativePublicationGate(question, undefined).publishable).toBe(false);
    const broken = {
      ...question,
      visualRegions: [
        { page: 41, role: "question" as const, rect: { x: 0.8, y: 0.2, width: 0.4, height: 0.2 } },
      ],
    };
    const gate = nativePublicationGate(broken, document);
    expect(gate.publishable).toBe(false);
    expect(gate.issues).toContain("região visual inválida");
    expect(gate.issues).toContain("região aponta para página inexistente");
  });

  it("amarra provider, ano, edição e fase da questão ao documento-fonte", () => {
    const namedDocument: NativeDocumentRecord = { ...document, editionId: "v1" };
    const mismatched: NativeQuestionContentRecord = {
      ...question,
      providerId: "fuvest",
      year: 2025,
      editionId: "v2",
      phase: "single",
    };
    const gate = nativePublicationGate(mismatched, namedDocument);
    expect(gate.publishable).toBe(false);
    expect(gate.issues).toEqual(
      expect.arrayContaining([
        "providerId divergente",
        "ano divergente",
        "editionId divergente",
        "fase divergente",
      ]),
    );
  });

  it("recusa metadados físicos inválidos do documento", () => {
    const invalidDocument: NativeDocumentRecord = {
      ...document,
      sourceBytes: Number.NaN,
      pageCount: 0,
      renderScale: 0,
    };
    const gate = nativePublicationGate(question, invalidDocument);
    expect(gate.publishable).toBe(false);
    expect(gate.issues).toEqual(
      expect.arrayContaining([
        "tamanho da fonte inválido",
        "quantidade de páginas inválida",
        "escala de renderização inválida",
        "região aponta para página inexistente",
      ]),
    );
  });

  it("pipeline v2 exige evidência explícita de completude visual", () => {
    const v2: NativeQuestionContentRecord = {
      ...question,
      extraction: { ...question.extraction, parserVersion: "native-pipeline@2.0.0" },
    };
    const gate = nativePublicationGate(v2, document);
    expect(gate.publishable).toBe(false);
    expect(gate.issues).toContain("pipeline v2 sem evidência de completude visual");
  });

  it("bloqueia dependência contextual não resolvida e valida a estratégia declarada", () => {
    const unresolved: NativeQuestionContentRecord = {
      ...question,
      extraction: {
        ...question.extraction,
        parserVersion: "native-pipeline@2.0.0",
        visualCompleteness: {
          required: true,
          resolved: false,
          reasons: ["context:romance"],
          strategy: "shared-context",
        },
      },
    };
    const unresolvedGate = nativePublicationGate(unresolved, document);
    expect(unresolvedGate.publishable).toBe(false);
    expect(unresolvedGate.issues).toEqual(
      expect.arrayContaining([
        "dependência visual/contextual não resolvida",
        "contexto compartilhado declarado sem região correspondente",
      ]),
    );

    const resolved: NativeQuestionContentRecord = {
      ...unresolved,
      visualRegions: [
        {
          page: 2,
          role: "shared-context",
          rect: { x: 0.04, y: 0.03, width: 0.92, height: 0.88 },
        },
        ...unresolved.visualRegions,
      ],
      extraction: {
        ...unresolved.extraction,
        visualCompleteness: {
          required: true,
          resolved: true,
          reasons: ["shared-range:1-5"],
          strategy: "shared-context",
        },
      },
    };
    expect(nativePublicationGate(resolved, document)).toEqual({ publishable: true, issues: [] });
  });
});
