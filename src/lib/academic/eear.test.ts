import { describe, expect, it } from "vitest";
import { academicMetadataForQuestion } from "./index";
import { classifyQuestion } from "../domain/classify";
import type { Question } from "../domain/types";

function question(editionId: string, number: number): Question {
  return {
    providerId: "eear",
    editionId,
    year: 2025,
    phase: "single",
    index: number,
    number,
    discipline: "conhecimentos-especificos",
    statementAvailable: false,
  };
}

describe("EEAR structural academic metadata", () => {
  it("classifica CFS pelas quatro faixas oficiais", () => {
    expect(academicMetadataForQuestion(question("2025-cfs-1-2026-opcao-01", 1))?.discipline).toBe(
      "Língua Portuguesa",
    );
    expect(academicMetadataForQuestion(question("2025-cfs-1-2026-opcao-01", 25))?.discipline).toBe(
      "Matemática",
    );
    expect(academicMetadataForQuestion(question("2025-cfs-1-2026-opcao-01", 49))?.discipline).toBe(
      "Física",
    );
    expect(academicMetadataForQuestion(question("2025-cfs-1-2026-opcao-01", 73))?.discipline).toBe(
      "Língua Inglesa",
    );
  });

  it("classifica EAGS em Português e conhecimentos específicos sem inventar subtópico", () => {
    const portuguese = academicMetadataForQuestion(question("2025-eags-eletronica", 40));
    const specific = academicMetadataForQuestion(question("2025-eags-eletronica", 41));
    expect(portuguese?.discipline).toBe("Língua Portuguesa");
    expect(specific?.discipline).toBe("Conhecimentos específicos");
    expect(specific?.subtopic).toBeNull();
  });

  it("faz reference-only participar do adaptativo com matéria correta", () => {
    const classified = classifyQuestion(question("2025-cfs-1-2026-opcao-01", 49));
    expect(classified.primary).toBe("Física");
    expect(classified.path).toContain("ciencias-natureza");
    expect(classified.confidence).toBe("alta");
  });
});
