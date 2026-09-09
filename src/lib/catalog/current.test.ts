import { describe, expect, it } from "vitest";
import { buildCurrentCatalog } from "./current";

describe("catálogo FAB", () => {
  it("lista AFA e EPCAR com contagens e família sem carregar enunciados", () => {
    const catalog = buildCurrentCatalog();
    const afa = catalog.query({ providerId: "afa" });
    const epcar = catalog.query({ providerId: "epcar" });
    expect(afa).toHaveLength(8);
    expect(afa.every((entry) => entry.questionCount === 64)).toBe(true);
    expect(afa.every((entry) => entry.statementAvailable === false)).toBe(true);
    expect(catalog.query({ providerId: "afa", family: "air-force" })).toHaveLength(8);
    // Oito, e não três: as outras cinco estavam declaradas como bloqueadas
    // sem que nenhum documento tivesse sido aberto. Os gabaritos oficiais de
    // 2018 a 2025 estão publicados e são legíveis.
    expect(epcar).toHaveLength(8);
    expect(epcar.every((entry) => entry.questionCount === 48)).toBe(true);
    expect(epcar.every((entry) => entry.statementAvailable === false)).toBe(true);
    expect(catalog.countQuestions({ providerIds: ["afa", "epcar"] })).toEqual({
      known: 896,
      unknownEditions: 0,
    });
  });
});

describe("catálogo v8.8", () => {
  it("lista os novos vestibulares com contagem leve e sem enunciado embutido", () => {
    const catalog = buildCurrentCatalog();
    expect(catalog.query({ providerId: "unicamp" }).map((entry) => entry.questionCount)).toEqual([
      72,
      72,
      72,
    ]);
    expect(catalog.query({ providerId: "uel" }).map((entry) => entry.questionCount)).toEqual([60]);
    expect(catalog.query({ providerId: "puc-sp" }).map((entry) => entry.questionCount)).toEqual([
      50,
      50,
      50,
    ]);
    expect(catalog.countQuestions({ providerIds: ["unicamp", "uel", "puc-sp"] })).toEqual({
      known: 426,
      unknownEditions: 0,
    });
    expect(catalog.query({ providerId: "unicamp" }).every((entry) => !entry.statementAvailable)).toBe(true);
  });
});

describe("catálogo v8.9", () => {
  it("lista as 18 edições UDESC em sessões leves separadas", () => {
    const catalog = buildCurrentCatalog();
    const entries = catalog.query({ providerId: "udesc" });

    expect(entries).toHaveLength(36);
    expect(new Set(entries.map((entry) => entry.editionId)).size).toBe(18);
    expect(entries.every((entry) => entry.questionCount === 50)).toBe(true);
    expect(entries.every((entry) => !entry.statementAvailable)).toBe(true);
    expect(entries.every((entry) => entry.validation === "reviewed")).toBe(true);
    expect(catalog.countQuestions({ providerId: "udesc" })).toEqual({
      known: 1800,
      unknownEditions: 0,
    });
  });

  it("lista nove edições ACAFE sem carregar os PDFs", () => {
    const catalog = buildCurrentCatalog();
    const entries = catalog.query({ providerId: "acafe" });

    expect(entries).toHaveLength(9);
    expect(entries.every((entry) => entry.questionCount === 63)).toBe(true);
    expect(entries.every((entry) => entry.phase === "single")).toBe(true);
    expect(entries.every((entry) => entry.validation === "reviewed")).toBe(true);
    expect(catalog.countQuestions({ providerId: "acafe" })).toEqual({
      known: 567,
      unknownEditions: 0,
    });
  });
});

describe("catálogo v8.9", () => {
  it("lista as 18 edições da UDESC por sessão sem carregar enunciados", () => {
    const catalog = buildCurrentCatalog();
    const entries = catalog.query({ providerId: "udesc" });

    expect(entries).toHaveLength(36);
    expect(new Set(entries.map((entry) => entry.editionId)).size).toBe(18);
    expect(entries.every((entry) => entry.questionCount === 50)).toBe(true);
    expect(entries.every((entry) => entry.statementAvailable === false)).toBe(true);
    expect(catalog.countQuestions({ providerIds: ["udesc"] })).toEqual({
      known: 1_800,
      unknownEditions: 0,
    });
  });
});

describe("catálogo v8.9", () => {
  it("lista as 18 edições da UDESC em duas sessões, sem carregar os PDFs", () => {
    const catalog = buildCurrentCatalog();
    const entries = catalog.query({ providerId: "udesc" });

    expect(entries).toHaveLength(36);
    expect(new Set(entries.map((entry) => entry.editionId))).toHaveLength(18);
    expect(entries.every((entry) => entry.questionCount === 50)).toBe(true);
    expect(entries.every((entry) => !entry.statementAvailable)).toBe(true);
    expect(catalog.countQuestions({ providerIds: ["udesc"] })).toEqual({
      known: 1_800,
      unknownEditions: 0,
    });
  });
});
