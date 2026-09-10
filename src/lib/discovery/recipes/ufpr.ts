import type { OfficialSourceRecipe } from "../sourceRecipe";

/**
 * UFPR official vestibular archive.
 *
 * The first horizontal benchmark intentionally covers the 11 editions from
 * PS2016 through PS2026. This range spans two site generations while keeping
 * discovery deterministic with one bounded HTML-link crawl:
 * - modern PortalNC pages (`Concurso?concurso=PS2026`);
 * - legacy static pages (`/ufpr/ps2017/index.htm`, `/ufpr/ps2016/index.htm`).
 *
 * Older editions remain outside this recipe for now because their archive
 * pages use an older framed layout that needs a separate generic primitive.
 * The recipe never guesses PDF URLs; it follows only links exposed by NC/UFPR.
 */
export const UFPR_OFFICIAL_RECIPE: OfficialSourceRecipe = {
  sourceId: "ufpr-nc-official",
  institution: "UFPR",
  archiveUrls: ["https://servicos.nc.ufpr.br/PortalNC/VestibularesAnteriores"],
  // Covers servicos.nc.ufpr.br, lua.nc.ufpr.br, www.nc.ufpr.br and legacy siblings.
  allowedHosts: ["nc.ufpr.br"],
  minYear: 2016,
  // Last edition verified against the official archive in 2026-09.
  maxYear: 2026,
  crawl: {
    maxDepth: 1,
    maxPages: 20,
    follow: [
      /\/PortalNC\/Concurso\?concurso=PS20\d{2}\b/i,
      /\/concursos_institucionais\/ufpr\/ps20\d{2}\/[^?#]+\.html?\b/i,
    ],
  },
  edition: {
    // Prefer PS identifiers in target/source-page URLs. Archive cycles such as
    // 2016/2017 therefore become the actual PS year, 2017.
    year: /(?:concurso=PS|\/ps|\bPS)(20\d{2})\b/i,
    editionId: (_candidate, year) => `PS${year}`,
    label: (_candidate, year) => `Processo Seletivo UFPR ${year}`,
  },
  documents: [
    {
      // Modern NC publishes the definitive first-phase booklet with correct
      // alternatives marked in the same PDF, so one URL is both source exam
      // and factual answer-key source.
      role: ["objective-exam", "answer-key"],
      match: /\/documentos\/ps20\d{2}\/provas\/definitivo\/Geral\.pdf\b/i,
      phase: "first",
      variant: "general",
    },
    {
      role: "answer-key-preliminary",
      match: /\/documentos\/ps20\d{2}\/provas\/provisorio\/Geral\.pdf\b/i,
      phase: "first",
      variant: "general",
    },
    {
      // Legacy PS2016/PS2017 pages point to the general first-phase booklet.
      // Their definitive document has the correct alternative marked in place.
      role: ["objective-exam", "answer-key"],
      match:
        /\/concursos_institucionais\/ufpr\/ps20(?:16|17)\/provas1fase\/[^?#]*conhecimentos[^?#]*\.pdf\b/i,
      phase: "first",
      variant: "general",
    },
  ],
};
