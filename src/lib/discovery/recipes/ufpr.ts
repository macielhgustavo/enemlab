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

function isUfprCrawlPage(url: string): boolean {
  return (
    /\/PortalNC\/Concurso(?:Publicacao)?\?[^#]*concurso=PS20\d{2}\b/i.test(url) ||
    /\/concursos_institucionais\/ufpr\/ps20\d{2}\/[^?#]+\.html?\b/i.test(url) ||
    /\/documentos\/PS2021\/provas1fase\/?$/i.test(url)
  );
}

/**
 * UFPR official vestibular archive.
 *
 * The benchmark covers PS2016–PS2026 and follows only NC/UFPR pages. The main
 * archive remains the discovery authority for normal years. Three stable
 * historical PDFs are pinned as document seeds because their PortalNC entries
 * sit behind long publication lists and should not depend on crawl queue order.
 * Definitive booklets carry marked correct alternatives, so one physical PDF
 * legitimately has objective-exam and answer-key roles.
 */
export const UFPR_OFFICIAL_RECIPE: OfficialSourceRecipe = {
  sourceId: "ufpr-nc-official",
  institution: "UFPR",
  archiveUrls: ["https://servicos.nc.ufpr.br/PortalNC/VestibularesAnteriores"],
  documentSeeds: [
    {
      url: "https://servicos.nc.ufpr.br/documentos/ps2018/provas1fase/ps2018_conhecimentos_gerais.pdf",
    },
    {
      url: "https://servicos.nc.ufpr.br/documentos/PS2019/provas1fase/ps2019_conhecimentos_gerais.pdf",
    },
    {
      url: "https://servicos.nc.ufpr.br/documentos/PS2021/provas1fase/ps2021_conhecimentos_gerais_ingles.pdf",
    },
  ],
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
    // `follow` also sees source-page context. Guard the actual target URL so a
    // PDF linked from a PortalNC page can never consume crawl-page budget.
    acceptPage: (candidate) => isUfprCrawlPage(candidate.url),
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
