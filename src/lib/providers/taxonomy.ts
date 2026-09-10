// Taxonomia por prova.
//
// Cada banca divide o conteúdo do seu jeito: o ENEM em quatro áreas
// ("linguagens"), o ITA em matérias ("physics"). As telas liam `AREA_ORDER` e
// `AREA_LABELS` do ENEM direto, então o painel do ITA listava as áreas do ENEM
// zeradas e rótulos de matéria apareciam crus ("mathematics").
//
// A taxonomia já existe em `metadata.areas` de cada provider. Este módulo é o
// contrato de leitura — nenhuma tela deve ter a sua própria tabela de rótulos.
// Importa do índice, não do registry: é o índice que registra as provas.
import { getProvider, listProviders, resolveProviderId } from "./index";

export interface TaxonomyArea {
  id: string;
  label: string;
}

/** Áreas da prova, na ordem em que o provider as declara. */
export function areasOf(providerId?: string | null): TaxonomyArea[] {
  try {
    return getProvider(providerId).metadata.areas;
  } catch {
    return [];
  }
}

/**
 * Rótulo humano de uma área.
 *
 * `providerId` ausente ou desconhecido faz a busca em todas as provas
 * registradas — o Histórico mistura bancas de propósito e ainda precisa
 * nomear cada linha. Sem correspondência, devolve o id como veio: mostrar
 * "physics" é feio, inventar "Física Geral" é mentira.
 */
export function areaLabel(areaId: string, providerId?: string | null): string {
  if (!areaId) return "";

  const doProvider = areasOf(providerId).find((a) => a.id === areaId);
  if (doProvider) return doProvider.label;

  for (const p of listProviders()) {
    const achado = p.metadata.areas.find((a) => a.id === areaId);
    if (achado) return achado.label;
  }
  return areaId;
}

/** A prova conhece esta área? Usado para não somar domínios de bancas diferentes. */
export function providerHasArea(providerId: string | null | undefined, areaId: string): boolean {
  return areasOf(resolveProviderId(providerId)).some((a) => a.id === areaId);
}
