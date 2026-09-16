import { describe, expect, it } from "vitest";
import { buildCurrentCatalog } from "@/lib/catalog/current";
import {
  eearEditions,
  eearQuestions,
  fatecEditions,
  fatecQuestions,
  getProvider,
  unespFirstPhaseQuestions,
  unespYears,
  unioesteQuestions,
  unioesteYears,
} from "@/lib/providers";
import { listSources } from "@/lib/sources";

const MASS1_IDS = ["eear", "fatec", "unesp", "unioeste"] as const;

describe("Mass Ingestion 1", () => {
  it("mantém 49 edições lógicas após a remoção explícita da EEAR 2018 Enfermagem", () => {
    expect(eearEditions()).toHaveLength(34);
    expect(fatecEditions()).toHaveLength(8);
    expect(unespYears()).toHaveLength(1);
    expect(unioesteYears()).toHaveLength(6);

    const logicalEditions =
      eearEditions().length + fatecEditions().length + unespYears().length + unioesteYears().length;
    expect(logicalEditions).toBe(49);
  });

  it("registra os quatro providers e suas fontes ativas", () => {
    const sources = listSources();
    for (const providerId of MASS1_IDS) {
      expect(getProvider(providerId).id).toBe(providerId);
      expect(sources.find((source) => source.providerId === providerId)?.status).toBe("active");
    }
  });

  it("mantém 4.420 questões conhecidas sem edição de contagem desconhecida", () => {
    const catalog = buildCurrentCatalog();
    expect(catalog.countQuestions({ providerIds: [...MASS1_IDS] })).toEqual({
      known: 4_420,
      unknownEditions: 0,
    });
    expect(catalog.query({ providerId: "eear" })).toHaveLength(34);
    expect(catalog.query({ providerId: "fatec" })).toHaveLength(8);
    expect(catalog.query({ providerId: "unesp" })).toHaveLength(1);
    expect(catalog.query({ providerId: "unioeste" })).toHaveLength(12);
  });

  it("mantém somente resposta única e não inventa a alternativa E na EEAR", () => {
    const eear = eearQuestions(eearEditions()[0].id)[0];
    expect(eear.type).toBe("multiple_choice");
    expect(eear.alternatives.map((alternative) => alternative.letter)).toEqual(["A", "B", "C", "D"]);

    for (const question of [
      fatecQuestions(fatecEditions()[0].id)[0],
      unespFirstPhaseQuestions(2026)[0],
      unioesteQuestions(2026)[0],
    ]) {
      expect(question.type).toBe("multiple_choice");
      expect(question.alternatives.map((alternative) => alternative.letter)).toEqual(["A", "B", "C", "D", "E"]);
      expect(question.statementAvailable).toBe(false);
    }
  });
});
