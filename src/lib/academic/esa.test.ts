import { describe, expect, it } from "vitest";
import { academicMetadataForQuestion } from "./index";
import { classifyQuestion } from "../domain/classify";
import type { Question } from "../domain/types";

function question(number: number): Question {
  return {
    providerId: "esa",
    editionId: "2025-geral-a",
    year: 2025,
    phase: "single",
    index: number,
    number,
    discipline: "linguagens",
    statementAvailable: false,
  };
}

describe("ESA structural academic metadata", () => {
  it("preserva as quatro matérias da prova geral", () => {
    expect(academicMetadataForQuestion(question(1))?.discipline).toBe("Matemática");
    expect(academicMetadataForQuestion(question(15))?.discipline).toBe("Língua Portuguesa");
    expect(academicMetadataForQuestion(question(29))?.discipline).toBe("História e Geografia do Brasil");
    expect(academicMetadataForQuestion(question(41))?.discipline).toBe("Língua Inglesa");
  });

  it("leva a matéria estrutural para o domínio/adaptativo", () => {
    const classified = classifyQuestion(question(41));
    expect(classified.primary).toBe("Língua Inglesa");
    expect(classified.path).toContain("linguagens");
  });
});
