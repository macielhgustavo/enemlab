import type { StudyIntelligenceState, StudyProviderConfig } from "./types";

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function mergeProviderConfig(
  cloud: Record<string, StudyProviderConfig>,
  local: Record<string, StudyProviderConfig>,
): Record<string, StudyProviderConfig> {
  const out: Record<string, StudyProviderConfig> = {};
  for (const key of new Set([...Object.keys(cloud), ...Object.keys(local)])) {
    out[key] = { ...(cloud[key] ?? {}), ...(local[key] ?? {}) };
  }
  return out;
}

/**
 * Eventos são unidos por ID e o dispositivo atual vence apenas quando o mesmo
 * ID existe dos dois lados. Configuração é mesclada por provider/campo.
 */
export function mergeStudyIntelligenceState(
  cloud?: StudyIntelligenceState | null,
  local?: StudyIntelligenceState | null,
): StudyIntelligenceState | undefined {
  if (!cloud && !local) return undefined;
  const c = cloud ?? { decisions: {}, experiments: {}, providerConfig: {} };
  const l = local ?? { decisions: {}, experiments: {}, providerConfig: {} };
  return {
    decisions: clone({ ...(c.decisions ?? {}), ...(l.decisions ?? {}) }),
    experiments: clone({ ...(c.experiments ?? {}), ...(l.experiments ?? {}) }),
    providerConfig: clone(mergeProviderConfig(c.providerConfig ?? {}, l.providerConfig ?? {})),
  };
}
