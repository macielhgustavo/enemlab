// Registry de providers de prova.
//
// Compatibilidade: tentativas, questões e itens de SRS gravados antes da
// fundação multi-provas não têm `providerId`. Tudo que vier sem esse campo
// é tratado como ENEM.
import type { ExamProvider } from "./types";

export const DEFAULT_PROVIDER_ID = "enem";

/**
 * Providers habilitados para novas sessões no produto.
 *
 * O registry completo continua carregado para preservar histórico, dados
 * ingeridos e reativação futura. Alterar esta lista não apaga provider algum.
 */
export const ENABLED_PROVIDER_IDS = [DEFAULT_PROVIDER_ID] as const;
const enabledProviderIds = new Set<string>(ENABLED_PROVIDER_IDS);

const providers = new Map<string, ExamProvider>();

export function registerProvider(provider: ExamProvider): void {
  providers.set(provider.id, provider);
}

/** Resolve qualquer provider registrado, inclusive os temporariamente inativos. */
export function getProvider(id?: string | null): ExamProvider {
  const provider = providers.get(resolveProviderId(id));
  if (!provider) {
    throw new Error(`Provider não registrado: ${resolveProviderId(id)}`);
  }
  return provider;
}

/**
 * Providers disponíveis na experiência atual do produto.
 * Hoje: somente ENEM.
 */
export function listProviders(): ExamProvider[] {
  return [...providers.values()].filter((provider) => enabledProviderIds.has(provider.id));
}

/** Registry completo, para histórico, catálogo interno e auditorias. */
export function listRegisteredProviders(): ExamProvider[] {
  return [...providers.values()];
}

export function isProviderEnabled(id?: string | null): boolean {
  return enabledProviderIds.has(resolveProviderId(id));
}

export function hasProvider(id?: string | null): boolean {
  return providers.has(resolveProviderId(id));
}

/**
 * Normaliza o identificador de provider de registros persistidos.
 * Dados legados (sem `providerId`) são ENEM.
 *
 * Não faz clamp para providers ativos: histórico antigo precisa preservar sua
 * banca original.
 */
export function resolveProviderId(id?: string | null): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  return trimmed || DEFAULT_PROVIDER_ID;
}

/** Resolve uma preferência de UI/executável para um provider atualmente ativo. */
export function resolveEnabledProviderId(id?: string | null): string {
  const resolved = resolveProviderId(id);
  return isProviderEnabled(resolved) ? resolved : DEFAULT_PROVIDER_ID;
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
