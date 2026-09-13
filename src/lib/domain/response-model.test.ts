import { describe, expect, it } from "vitest";
import {
  canonicalMultipleChoice,
  validateResponseModel,
} from "./response-model";

describe("multiple-choice response model", () => {
  it("normalizes a valid single-answer response", () => {
    expect(
      canonicalMultipleChoice(
        { kind: "single-choice", optionIds: ["A", "B", "C", "D", "E"] },
        "C",
      ),
    ).toEqual({ kind: "single-choice", optionId: "C" });
  });

  it("rejects answers outside the declared multiple-choice domain", () => {
    expect(() =>
      canonicalMultipleChoice(
        { kind: "single-choice", optionIds: ["A", "B", "C"] },
        "D",
      ),
    ).toThrow(/unknown option id/i);
  });

  it("rejects malformed multiple-choice domains", () => {
    expect(
      validateResponseModel({ kind: "single-choice", optionIds: ["A", "A"] }),
    ).toContain("single-choice contains duplicate option ids");
  });
});
