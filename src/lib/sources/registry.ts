// Registry de fontes de prova.
import type { ExamSourceDefinition } from "./types";
import {
  acafeSource,
  afaSource,
  eearResearchSource,
  enemOfficialSource,
  enemSource,
  epcarSource,
  esaSource,
  espcexSource,
  fuvestSource,
  imeSource,
  itaSource,
  mackenzieResearchSource,
  pucPrResearchSource,
  pucRioResearchSource,
  pucSpSource,
  udescSource,
  uelSource,
  uemResearchSource,
  uepgResearchSource,
  ufprResearchSource,
  ufrjHistoricalResearchSource,
  ufscResearchSource,
  unespResearchSource,
  unicampSource,
} from "./definitions";

const SOURCES = new Map<string, ExamSourceDefinition>([
  [enemSource.id, enemSource],
  [itaSource.id, itaSource],
  [imeSource.id, imeSource],
  [enemOfficialSource.id, enemOfficialSource],
  [fuvestSource.id, fuvestSource],
  [afaSource.id, afaSource],
  [epcarSource.id, epcarSource],
  [espcexSource.id, espcexSource],
  [esaSource.id, esaSource],
  [unicampSource.id, unicampSource],
  [uelSource.id, uelSource],
  [pucSpSource.id, pucSpSource],
  [uemResearchSource.id, uemResearchSource],
  [uepgResearchSource.id, uepgResearchSource],
  [unespResearchSource.id, unespResearchSource],
  [ufscResearchSource.id, ufscResearchSource],
  [udescSource.id, udescSource],
  [acafeSource.id, acafeSource],
  [pucPrResearchSource.id, pucPrResearchSource],
  [pucRioResearchSource.id, pucRioResearchSource],
  [mackenzieResearchSource.id, mackenzieResearchSource],
  [ufrjHistoricalResearchSource.id, ufrjHistoricalResearchSource],
  [ufprResearchSource.id, ufprResearchSource],
  [eearResearchSource.id, eearResearchSource],
]);

export function listSources(): ExamSourceDefinition[] {
  return [...SOURCES.values()];
}

export function getSource(id: string): ExamSourceDefinition {
  const s = SOURCES.get(id);
  if (!s) throw new Error(`Fonte não registrada: ${id}`);
  return s;
}

/** Fontes que alimentam um provider. */
export function sourcesForProvider(providerId: string): ExamSourceDefinition[] {
  return listSources().filter((s) => s.providerId === providerId);
}
