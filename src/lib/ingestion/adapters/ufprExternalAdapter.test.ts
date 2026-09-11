import { describe, expect, it } from "vitest";
import type { DiscoveredEdition } from "../../sources/ingestion";
import { createExternalExtractionEnvelope } from "../protocol";
import type { IngestionExtractionContext } from "../types";
import {
  createUfprExternalAdapter,
  UFPR_CANONICAL_VARIANT,
  UFPR_EXPECTED_COUNTS,
} from "./ufprExternalAdapter";

const SHARED = "https://servicos.nc.ufpr.br/documentos/ps2024/provas/Geral.pdf";
const ENGLISH =
  "https://servicos.nc.ufpr.br/documentos/PS2021/provas1fase/ps2021_conhecimentos_gerais_ingles.pdf";
const FRENCH =
  "https://servicos.nc.ufpr.br/documentos/PS2021/provas1fase/ps2021_conhecimentos_gerais_frances.pdf";

function multiRole(url: string, variant?: string): DiscoveredEdition["documents"] {
  return [
    { role: "objective-exam", url, phase: "first", variant },
    { role: "answer-key", url, phase: "first", variant },
  ];
}

describe("UFPR external adapter", () => {
  it("keeps an explicit expected-count profile for the verified benchmark", () => {
    expect(UFPR_EXPECTED_COUNTS).toEqual({
      2016: 80,
      2017: 80,
      2018: 80,
      2019: 90,
      2020: 90,
      2021: 60,
      2022: 60,
      2023: 90,
      2024: 90,
      2025: 90,
      2026: 90,
    });
  });

  it("plans a shared definitive booklet once with English as canonical variant", async () => {
    const adapter = createUfprExternalAdapter(async () => ({}));
    const edition: DiscoveredEdition = {
      editionId: "PS2024",
      year: 2024,
      label: "UFPR 2024",
      documents: multiRole(SHARED),
    };

    const plans = await adapter.plan(edition);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      editionId: "PS2024",
      year: 2024,
      phase: "first",
      variant: UFPR_CANONICAL_VARIANT,
      expectedCount: 90,
    });
    expect(new Set(plans[0].documents.map((document) => document.url))).toEqual(
      new Set([SHARED]),
    );
  });

  it("selects only the English physical booklet in PS2021", async () => {
    const adapter = createUfprExternalAdapter(async () => ({}));
    const edition: DiscoveredEdition = {
      editionId: "PS2021",
      year: 2021,
      label: "UFPR 2021",
      documents: [
        ...multiRole(ENGLISH, "english"),
        ...multiRole(FRENCH, "french"),
      ],
    };

    const [plan] = await adapter.plan(edition);
    expect(plan.expectedCount).toBe(60);
    expect(plan.documents).toHaveLength(2);
    expect(plan.documents.every((document) => document.variant === "english")).toBe(true);
    expect(plan.documents.every((document) => document.url === ENGLISH)).toBe(true);
  });

  it("consumes a SHA-bound external extraction through the normal protocol", async () => {
    let loaderContext: IngestionExtractionContext | null = null;
    const adapter = createUfprExternalAdapter(async (context) => {
      loaderContext = context;
      return createExternalExtractionEnvelope(
        context,
        { providerId: "ufpr", sourceId: "ufpr-nc-official" },
        { name: "test", version: "1" },
        {
          questions: [
            {
              number: 1,
              statement: "Questão",
              alternatives: ["A", "B", "C", "D", "E"].map((id) => ({
                id,
                text: id,
              })),
            },
          ],
          answerKey: { 1: "A" },
        },
      );
    });

    const definitions = multiRole(SHARED);
    const context: IngestionExtractionContext = {
      plan: {
        editionId: "PS2024",
        year: 2024,
        phase: "first",
        variant: "english",
        expectedCount: 1,
        allowedLetters: ["A", "B", "C", "D", "E"],
        documents: definitions,
      },
      documents: definitions.map((definition) => ({
        definition,
        fetched: {
          url: SHARED,
          bytes: new Uint8Array([1]),
          headers: {},
        },
        fingerprint: {
          url: SHARED,
          contentLength: 1,
          sha256: "a".repeat(64),
          parserVersion: "test@1",
          importedAt: "2026-09-10T00:00:00Z",
        },
      })),
    };

    const extraction = await adapter.extract(context);
    expect(loaderContext).toBe(context);
    expect(extraction.answerKey).toEqual({ 1: "A" });
  });

  it("fails closed when exam and answer source resolve to different physical files", () => {
    const adapter = createUfprExternalAdapter(async () => ({}));
    const edition: DiscoveredEdition = {
      editionId: "PS2024",
      year: 2024,
      label: "UFPR 2024",
      documents: [
        { role: "objective-exam", url: SHARED, phase: "first" },
        { role: "answer-key", url: `${SHARED}?key=1`, phase: "first" },
      ],
    };

    expect(() => adapter.plan(edition)).toThrow(/one definitive booklet/);
  });
});
