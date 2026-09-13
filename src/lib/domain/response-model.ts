export interface MultipleChoiceResponseModel {
  kind: "single-choice";
  optionIds: string[];
}

/**
 * Studium Labs intentionally supports only single-answer multiple-choice exams.
 * Sum-of-propositions and open-response formats are outside the current product
 * scope and must not be coerced into this model.
 */
export type ResponseModel = MultipleChoiceResponseModel;

export interface CanonicalMultipleChoiceResponse {
  kind: "single-choice";
  optionId: string;
}

export function validateResponseModel(model: ResponseModel): string[] {
  const ids = model.optionIds.map((id) => id.trim());
  const issues: string[] = [];
  if (ids.length < 2) issues.push("single-choice requires at least two options");
  if (ids.some((id) => !id)) issues.push("single-choice contains an empty option id");
  if (new Set(ids).size !== ids.length) issues.push("single-choice contains duplicate option ids");
  return issues;
}

export function canonicalMultipleChoice(
  model: MultipleChoiceResponseModel,
  optionId: string,
): CanonicalMultipleChoiceResponse {
  const issues = validateResponseModel(model);
  if (issues.length) throw new Error(issues.join("; "));
  const normalized = optionId.trim();
  if (!model.optionIds.includes(normalized)) throw new Error(`unknown option id: ${normalized}`);
  return { kind: "single-choice", optionId: normalized };
}
