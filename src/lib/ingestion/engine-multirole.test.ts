import { describe, expect, it, vi } from "vitest";
import type {
  DiscoveredEdition,
  DocumentFetcher,
  ExamSourceDiscovery,
} from "../sources/ingestion";
import { IngestionEngine } from "./engine";
import type { IngestionAdapter } from "./types";

const URL = "https://servicos.nc.ufpr.br/documentos/ps2026/provas/definitivo/Geral.pdf";

function discoveryFor(documents: DiscoveredEdition["documents"]): ExamSourceDiscovery {
  return {
    sourceId: "ufpr-nc-official",
    discover: async () => [
      {
        editionId: "PS2026",
        year: 2026,
        label: "UFPR 2026",
        documents,
      },
    ],
    isAllowed: () => true,
  };
}

function adapterFor(documents: DiscoveredEdition["documents"]): IngestionAdapter {
  return {
    providerId: "ufpr",
    sourceId: "ufpr-nc-official",
    importerVersion: "ufpr-test@1",
    discovery: discoveryFor(documents),
    statementMode: "structured",
    extractionMethod: "pdf-text-layer",
    rightsStatus: "allowed",
    plan: (edition) => [
      {
        editionId: edition.editionId,
        year: edition.year,
        phase: "first",
        variant: "general",
        expectedCount: 1,
        allowedLetters: ["A", "B", "C", "D", "E"],
        documents: edition.documents,
      },
    ],
    extract: async () => ({
      questions: [
        {
          number: 1,
          statement: "Questão de teste",
          alternatives: ["A", "B", "C", "D", "E"].map((id) => ({ id, text: id })),
        },
      ],
      answerKey: { 1: "A" },
    }),
  };
}

const fetcher: DocumentFetcher = async (url) => ({
  url,
  bytes: new TextEncoder().encode("same-physical-pdf"),
  headers: { "content-type": "application/pdf" },
});

describe("IngestionEngine multi-role documents", () => {
  it("allows one physical URL to satisfy exam and answer-key roles", async () => {
    const documents: DiscoveredEdition["documents"] = [
      { role: "objective-exam", url: URL, phase: "first", variant: "general" },
      { role: "answer-key", url: URL, phase: "first", variant: "general" },
    ];

    const result = await new IngestionEngine().run([adapterFor(documents)], fetcher);

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].status).toBe("ready-for-review");
    expect(result.jobs[0].engineIssues).toEqual([]);
    expect(result.jobs[0].documentsFetched).toBe(2);
  });

  it("still rejects an exact duplicate logical document definition", async () => {
    const extract = vi.fn(async () => ({
      questions: [{ number: 1 }],
      answerKey: { 1: "A" },
    }));
    const duplicate = {
      role: "objective-exam" as const,
      url: URL,
      phase: "first",
      variant: "general",
    };
    const value = adapterFor([duplicate, { ...duplicate }]);
    value.extract = extract;

    const result = await new IngestionEngine().run([value], fetcher);

    expect(result.jobs[0].status).toBe("blocked");
    expect(result.jobs[0].engineIssues[0].code).toBe("invalid-plan");
    expect(result.jobs[0].engineIssues[0].message).toContain("duplicate document definitions");
    expect(extract).not.toHaveBeenCalled();
  });
});
