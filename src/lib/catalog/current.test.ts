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
