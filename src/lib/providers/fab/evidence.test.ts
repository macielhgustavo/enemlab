import { describe, expect, it } from "vitest";
import { fabValidationLevel, type FabEvidence } from "./evidence";
import records from "./evidence.generated.json";
import afa from "../afa/answer-keys.generated.json";
import type { FabAnswerKeyRaw } from "./index";
import { CatalogIndex } from "../../catalog";

const raw = afa["2024"] as unknown as FabAnswerKeyRaw;
const evidence = records["afa-2024"] as FabEvidence;

describe("níveis FAB vinculados à evidência documental", () => {
  it("AFA 2024 conferida é reviewed", () => expect(fabValidationLevel("afa", raw)).toBe("reviewed"));
  it("evidência ausente não herda reviewed", () => expect(fabValidationLevel("missing", raw)).toBe("provisional"));
  it("evidência provisional continua provisional", () => expect(fabValidationLevel("afa", raw, { ...evidence, validationLevel: "provisional" })).toBe("provisional"));
  it("evidência bloqueada permanece bloqueada", () => expect(fabValidationLevel("afa", raw, { ...evidence, validationLevel: "blocked" })).toBe("blocked"));
  it("edição alterada após conferência é bloqueada", () => expect(fabValidationLevel("afa", { ...raw, sequence: "alterada" })).toBe("blocked"));
  it("checksum alterado é bloqueado", () => expect(fabValidationLevel("afa", { ...raw, retrieval: { ...raw.retrieval, sha256: "0".repeat(64) } })).toBe("blocked"));
  it("sem data de leitura não é reviewed", () => expect(fabValidationLevel("afa", raw, { ...evidence, fetchedAt: null })).toBe("provisional"));
  it("banco padrão exclui provisional e blocked", () => {
    const entries = (["reviewed", "provisional", "blocked"] as const).map((validation, index) => ({
      providerId: "afa", editionId: String(2024 + index), year: 2024 + index, phase: "first",
      questionCount: 64, subjects: {}, validation, sourceId: "afa-official-archive",
      statementAvailable: false, importerVersion: "test",
    }));
    expect(new CatalogIndex(entries).yearsOf("afa")).toEqual([2024]);
  });
});
