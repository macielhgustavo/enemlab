import { describe, expect, it } from "vitest";
import {
  canonicalPropositionSum,
  canonicalSingleChoice,
  decodePropositionSum,
  formatCanonicalResponse,
  validateResponseModel,
  type SumOfPropositionsResponseModel,
} from "./response-model";

const UEM_STYLE: SumOfPropositionsResponseModel = {
  kind: "sum-of-propositions",
  propositionValues: [1, 2, 4, 8, 16],
  zeroAnswerAllowed: true,
  displayWidth: 2,
};

describe("response model", () => {
  it("keeps single-choice semantics unchanged", () => {
    expect(canonicalSingleChoice({ kind: "single-choice", optionIds: ["A", "B", "C"] }, "B"))
      .toEqual({ kind: "single-choice", optionId: "B" });
  });

  it("stores proposition identities in addition to their published sum", () => {
    const response = canonicalPropositionSum(UEM_STYLE, [16, 1, 4]);
    expect(response).toEqual({
      kind: "sum-of-propositions",
      selectedValues: [1, 4, 16],
      sum: 21,
    });
    expect(formatCanonicalResponse(response, UEM_STYLE)).toBe("21");
  });

  it("decodes standard UEM/UEPG sums without losing semantics", () => {
    expect(decodePropositionSum(UEM_STYLE, 5)).toEqual({
      kind: "sum-of-propositions",
      selectedValues: [1, 4],
      sum: 5,
    });
    expect(formatCanonicalResponse(decodePropositionSum(UEM_STYLE, 0), UEM_STYLE)).toBe("00");
  });

  it("fails closed for sums outside or ambiguous in the declared domain", () => {
    expect(() => decodePropositionSum(UEM_STYLE, 32)).toThrow(/outside proposition domain/i);

    const ambiguous: SumOfPropositionsResponseModel = {
      kind: "sum-of-propositions",
      propositionValues: [1, 2, 3],
      zeroAnswerAllowed: false,
    };
    expect(() => decodePropositionSum(ambiguous, 3)).toThrow(/ambiguous/i);
  });

  it("rejects malformed response domains before they reach a provider", () => {
    expect(validateResponseModel({
      kind: "sum-of-propositions",
      propositionValues: [1, 1, 4],
      zeroAnswerAllowed: true,
    })).toContain("proposition values must be unique");
  });
});
