export type SingleChoiceResponseModel = {
  kind: "single-choice";
  optionIds: string[];
};

export type SumOfPropositionsResponseModel = {
  kind: "sum-of-propositions";
  propositionValues: number[];
  zeroAnswerAllowed: boolean;
  displayWidth?: number;
};

export type OpenResponseModel = {
  kind: "open";
  answerFormat?: "text" | "integer" | "decimal";
};

/**
 * Future-facing response semantics. This type is intentionally not wired into
 * persisted Question/Attempt yet: introducing the contract first lets us prove
 * UEM/UEPG/UFSC semantics without migrating existing two-user study history.
 */
export type ResponseModel =
  | SingleChoiceResponseModel
  | SumOfPropositionsResponseModel
  | OpenResponseModel;

export type CanonicalResponse =
  | { kind: "single-choice"; optionId: string }
  | { kind: "sum-of-propositions"; selectedValues: number[]; sum: number }
  | { kind: "open"; value: string };

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function validateResponseModel(model: ResponseModel): string[] {
  if (model.kind === "single-choice") {
    const ids = model.optionIds.map((id) => id.trim());
    const issues: string[] = [];
    if (ids.length < 2) issues.push("single-choice requires at least two options");
    if (ids.some((id) => !id)) issues.push("single-choice contains an empty option id");
    if (unique(ids).length !== ids.length) issues.push("single-choice contains duplicate option ids");
    return issues;
  }

  if (model.kind === "sum-of-propositions") {
    const values = model.propositionValues;
    const issues: string[] = [];
    if (values.length < 2) issues.push("sum-of-propositions requires at least two proposition values");
    if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
      issues.push("proposition values must be positive integers");
    }
    if (unique(values).length !== values.length) issues.push("proposition values must be unique");
    if (model.displayWidth !== undefined && (!Number.isInteger(model.displayWidth) || model.displayWidth < 1)) {
      issues.push("displayWidth must be a positive integer");
    }
    return issues;
  }

  return [];
}

export function canonicalSingleChoice(
  model: SingleChoiceResponseModel,
  optionId: string,
): CanonicalResponse {
  const issues = validateResponseModel(model);
  if (issues.length) throw new Error(issues.join("; "));
  const normalized = optionId.trim();
  if (!model.optionIds.includes(normalized)) throw new Error(`unknown option id: ${normalized}`);
  return { kind: "single-choice", optionId: normalized };
}

export function canonicalPropositionSum(
  model: SumOfPropositionsResponseModel,
  selectedValues: readonly number[],
): CanonicalResponse {
  const issues = validateResponseModel(model);
  if (issues.length) throw new Error(issues.join("; "));
  const selected = unique(selectedValues).sort((a, b) => a - b);
  if (selected.length === 0 && !model.zeroAnswerAllowed) {
    throw new Error("zero-answer selection is not allowed");
  }
  const domain = new Set(model.propositionValues);
  for (const value of selected) {
    if (!domain.has(value)) throw new Error(`unknown proposition value: ${value}`);
  }
  return {
    kind: "sum-of-propositions",
    selectedValues: selected,
    sum: selected.reduce((total, value) => total + value, 0),
  };
}

/**
 * Converts a published numeric sum back into proposition semantics when the
 * proposition values form a uniquely-decodable binary-style domain such as
 * 01/02/04/08/16. Rejects ambiguity instead of guessing.
 */
export function decodePropositionSum(
  model: SumOfPropositionsResponseModel,
  sum: number,
): CanonicalResponse {
  const issues = validateResponseModel(model);
  if (issues.length) throw new Error(issues.join("; "));
  if (!Number.isInteger(sum) || sum < 0) throw new Error("sum must be a non-negative integer");
  if (sum === 0) return canonicalPropositionSum(model, []);

  const values = [...model.propositionValues].sort((a, b) => b - a);
  const matches: number[][] = [];

  function visit(index: number, remaining: number, chosen: number[]) {
    if (remaining === 0) {
      matches.push([...chosen]);
      return;
    }
    if (remaining < 0 || index >= values.length || matches.length > 1) return;
    visit(index + 1, remaining - values[index], [...chosen, values[index]]);
    visit(index + 1, remaining, chosen);
  }

  visit(0, sum, []);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? `sum ${sum} is outside proposition domain` : `sum ${sum} is ambiguous`);
  }
  return canonicalPropositionSum(model, matches[0]);
}

export function formatCanonicalResponse(response: CanonicalResponse, model: ResponseModel): string {
  if (response.kind === "single-choice") return response.optionId;
  if (response.kind === "open") return response.value;
  if (model.kind !== "sum-of-propositions") throw new Error("response/model kind mismatch");
  const raw = String(response.sum);
  return model.displayWidth ? raw.padStart(model.displayWidth, "0") : raw;
}
