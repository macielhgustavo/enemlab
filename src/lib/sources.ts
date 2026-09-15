// Camada compatível de extensão do registry de fontes.
//
// O registry histórico continua em `sources/index.ts`. As Mass Ingestions
// acrescentam fontes ativas sem reescrever esse arquivo grande nem apagar as
// entradas de pesquisa que documentam decisões anteriores.
export * from "./sources/index";
export * from "./sources/mass-ingestion";
export * from "./sources/mass-ingestion-2";

import {
  getSource as getBaseSource,
  listSources as listBaseSources,
} from "./sources/index";
import { MASS_INGESTION_SOURCES } from "./sources/mass-ingestion";
import { MASS_INGESTION_2_SOURCES } from "./sources/mass-ingestion-2";
import type { ExamSourceDefinition } from "./sources/types";

const EXTRA_SOURCES = [...MASS_INGESTION_2_SOURCES, ...MASS_INGESTION_SOURCES];
const MASS_BY_ID = new Map(EXTRA_SOURCES.map((source) => [source.id, source]));

export function listSources(): ExamSourceDefinition[] {
  // Ativas primeiro: `buildCurrentCatalog()` usa a primeira fonte do provider.
  // As entradas `*-research` antigas permanecem depois delas como histórico.
  return [...EXTRA_SOURCES, ...listBaseSources()];
}

export function getSource(id: string): ExamSourceDefinition {
  return MASS_BY_ID.get(id) ?? getBaseSource(id);
}

export function sourcesForProvider(providerId: string): ExamSourceDefinition[] {
  return listSources().filter((source) => source.providerId === providerId);
}
