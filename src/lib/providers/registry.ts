// Registry de providers de prova.
//
// Compatibilidade: tentativas, questões e itens de SRS gravados antes da
// fundação multi-provas não têm `providerId`. Tudo que vier sem esse campo
// é tratado como ENEM — nunca como "desconhecido" —, porque até aqui o
// produto só suportava ENEM.
import type { ExamProvider } from "./types";

export const DEFAULT_PROVIDER_ID = "enem";

const providers = new Map<string, ExamProvider>();

export function registerProvider(provider: ExamProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id?: string | null): ExamProvider {
  const provider = providers.get(resolveProviderId(id));
  if (!provider) {
    throw new Error(`Provider não registrado: ${resolveProviderId(id)}`);
  }
  return provider;
}

export function listProviders(): ExamProvider[] {
  return [...providers.values()];
}

export function hasProvider(id?: string | null): boolean {
  return providers.has(resolveProviderId(id));
}

/**
 * Normaliza o identificador de provider de qualquer registro persistido.
 * Dados legados (sem `providerId`) são ENEM.
 */
export function resolveProviderId(id?: string | null): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  return trimmed || DEFAULT_PROVIDER_ID;
}

/** Dois registros pertencem à mesma prova? Usado para não misturar estatísticas. */
export function sameProvider(a?: string | null, b?: string | null): boolean {
  return resolveProviderId(a) === resolveProviderId(b);
}

/** Filtra qualquer coleção de registros persistidos por provider. */
export function filterByProvider<T extends { providerId?: string | null }>(
  items: T[],
  providerId?: string | null,
): T[] {
  return items.filter((item) => sameProvider(item.providerId, providerId));
}

/** Agrupa registros por provider, já normalizando os legados. */
export function groupByProvider<T extends { providerId?: string | null }>(
  items: T[],
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const key = resolveProviderId(item.providerId);
    (out[key] ??= []).push(item);
  }
  return out;
}
