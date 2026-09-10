export { UFPR_OFFICIAL_RECIPE } from "./ufpr";

import { UFPR_OFFICIAL_RECIPE } from "./ufpr";

/**
 * Recipes that are verified enough to participate in generic source harvesting.
 * Adding a recipe here does not publish any question data; publication gates
 * remain inside the canonical ingestion/review pipeline.
 */
export const OFFICIAL_SOURCE_RECIPES = [UFPR_OFFICIAL_RECIPE] as const;
