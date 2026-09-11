import { describe, expect, it } from "vitest";
import type { IngestionExtractionContext } from "./types";
import {
  consumeExternalExtraction,
  createExternalExtractionEnvelope,
} from "./protocol";

const URL = "https://official.example/definitivo.pdf";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function context(conflicting = false): IngestionExtractionContext {
  const definitions = [
    { role: "objective-exam" as const, url: URL, phase: "first" },
    { role: "answer-key" as const, url: URL, phase: "first" },
  ];
  return {
    plan: {
      editionId: "PS2026",
      year: 2026,
      phase: "first",
      variant: "english",
      expectedCount: 1,
      allowedLetters: ["A", "B", "C", "D", "E"],
      documents: definitions,
    },
    documents: definitions.map((definition, index) => ({
      definition,
      fetched: {
        url: URL,
        bytes: new Uint8Array([1, 2, 3]),
        headers: {},
      },
      fingerprint: {
        url: URL,
        contentLength: 3,
        sha256: conflicting && index === 1 ? HASH_B : HASH_A,
        parserVersion: "test@1",
        importedAt: "2026-09-10T00:00:00Z",
      },
    })),
  };
}

describe("external extraction multi-role physical documents", () => {
  it("binds one physical URL once even when the engine exposes two logical roles", () => {
    const ctx = context();
    const extraction = {
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
    };
    const envelope = createExternalExtractionEnvelope(
      ctx,
      { providerId: "ufpr", sourceId: "ufpr-nc-official" },
      { name: "test", version: "1" },
      extraction,
    );

    expect(envelope.documents).toEqual([{ url: URL, sha256: HASH_A }]);
    expect(
      consumeExternalExtraction(envelope, ctx, {
        providerId: "ufpr",
        sourceId: "ufpr-nc-official",
      }),
    ).toEqual(extraction);
  });

  it("fails closed if logical aliases somehow carry different physical hashes", () => {
    expect(() =>
      createExternalExtractionEnvelope(
        context(true),
        { providerId: "ufpr", sourceId: "ufpr-nc-official" },
        { name: "test", version: "1" },
        { questions: [], answerKey: {} },
      ),
    ).toThrow(/conflicting SHA-256/);
  });
});
