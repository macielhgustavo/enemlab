import type { OfficialSourceRecipe, SourceRecipeDocumentRule } from "../sourceRecipe";

const FIRST_PHASE_MARKED = ["objective-exam", "answer-key"] as const;

function languageRule(
  slug: string,
  variant: string,
): SourceRecipeDocumentRule {
  return {
    role: [...FIRST_PHASE_MARKED],
    match: new RegExp(
      `/documentos/PS2021/provas1fase/ps2021_conhecimentos_gerais_${slug}\\.pdf\\b`,
      "i",
    ),
    phase: "first",
    variant,
  };
}

/**
 * UFPR official vestibular archive.
 *
 * The benchmark covers PS2016–PS2026 and follows only NC/UFPR pages. It spans
 * legacy static pages, PortalNC publication pages and PS2021's intermediate
 * first-phase directory. Definitive booklets carry marked correct alternatives,
 * so one physical PDF legitimately has objective-exam and answer-key roles.
 */
export const UFPR_OFFICIAL_RECIPE: OfficialSourceRecipe = {
  sourceId: "ufpr-nc-official",
  institution: "UFPR",
  archiveUrls: ["https://servicos.nc.ufpr.br/PortalNC/VestibularesAnteriores"],
  allowedHosts: ["nc.ufpr.br"],
  minYear: 2016,
  maxYear: 2026,
  crawl: {
    maxDepth: 2,
    maxPages: 25,
    follow: [
      /\/PortalNC\/Concurso(?:Publicacao)?\?[^#]*concurso=PS20\d{2}\b/i,
      /\/concursos_institucionais\/ufpr\/ps20\d{2}\/[^?#]+\.html?\b/i,
      /\/documentos\/PS2021\/provas1fase\/?$/i,
    ],
  },
  edition: {
    year: /(?:concurso=PS|\/ps|\bPS)(20\d{2})\b/i,
    editionId: (_candidate, year) => `PS${year}`,
    label: (_candidate, year) => `Processo Seletivo UFPR ${year}`,
  },
  documents: [
    {
      role: [...FIRST_PHASE_MARKED],
      match:
        /\/documentos\/ps20(?:25|26)\/provas\/definitivo\/Geral\.pdf\b/i,
      phase: "first",
    },
    {
      role: "answer-key-preliminary",
      match:
        /\/documentos\/ps20(?:25|26)\/provas\/provisorio\/Geral\.pdf\b/i,
      phase: "first",
    },
    {
      role: [...FIRST_PHASE_MARKED],
      match: /\/documentos\/ps20(?:22|23|24)\/provas\/Geral\.pdf\b/i,
      phase: "first",
    },
    languageRule("ingles", "english"),
    languageRule("espanhol", "spanish"),
    languageRule("alemao", "german"),
    languageRule("frances", "french"),
    languageRule("italiano", "italian"),
    languageRule("japones", "japanese"),
    languageRule("polones", "polish"),
    {
      role: [...FIRST_PHASE_MARKED],
      match:
        /\/documentos\/ps20(?:18|19|20)\/provas1fase\/ps20(?:18|19|20)_conhecimentos_gerais\.pdf\b/i,
      phase: "first",
    },
    {
      role: [...FIRST_PHASE_MARKED],
      match:
        /\/concursos_institucionais\/ufpr\/ps20(?:16|17)\/provas1fase\/[^?#]*conhecimentos[^?#]*\.pdf\b/i,
      phase: "first",
    },
  ],
};
