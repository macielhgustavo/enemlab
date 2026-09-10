import { describe, expect, it } from "vitest";
import type { DocumentFetcher } from "../../sources/ingestion";
import { harvestOfficialSource } from "../sourceRecipe";
import { UFPR_OFFICIAL_RECIPE } from "./ufpr";

function routeFetcher(routes: Record<string, string>): DocumentFetcher {
  return async (url) => {
    const html = routes[url];
    if (html === undefined) throw new Error(`unexpected URL ${url}`);
    return {
      url,
      bytes: new TextEncoder().encode(html),
      headers: { "content-type": "text/html; charset=utf-8" },
    };
  };
}

describe("UFPR official source recipe", () => {
  it("harvests modern PortalNC and both verified legacy first-phase booklets", async () => {
    const archive = UFPR_OFFICIAL_RECIPE.archiveUrls[0];
    const modern = "https://servicos.nc.ufpr.br/PortalNC/Concurso?concurso=PS2026";
    const legacy2017 = "https://www.nc.ufpr.br/concursos_institucionais/ufpr/ps2017/index.htm";
    const legacy2016 = "https://www.nc.ufpr.br/concursos_institucionais/ufpr/ps2016/index.htm";

    const result = await harvestOfficialSource(
      UFPR_OFFICIAL_RECIPE,
      routeFetcher({
        [archive]: `
          <a href="${modern}">Acessar 2025/2026</a>
          <a href="${legacy2017}">Acessar 2016/2017</a>
          <a href="${legacy2016}">Acessar 2015/2016</a>
          <a href="https://example.org/not-official">Espelho</a>
        `,
        [modern]: `
          <a href="https://servicos.nc.ufpr.br/documentos/ps2026/provas/provisorio/Geral.pdf">Gabarito preliminar geral</a>
          <a href="https://servicos.nc.ufpr.br/documentos/ps2026/provas/definitivo/Geral.pdf">Gabarito definitivo geral</a>
          <a href="https://servicos.nc.ufpr.br/documentos/ps2026/provas/2fase/001-CPT.pdf">Segunda fase</a>
        `,
        [legacy2017]: `
          <a href="https://www.nc.ufpr.br/concursos_institucionais/ufpr/ps2017/provas1fase/PS2017_conhecimentos_gerais.pdf">Clique aqui</a>
          <a href="https://www.nc.ufpr.br/concursos_institucionais/ufpr/ps2017/provas2fase/fisica.pdf">Física 2ª fase</a>
        `,
        [legacy2016]: `
          <a href="https://www.nc.ufpr.br/concursos_institucionais/ufpr/ps2016/provas1fase/PS2016_conhecimentos_gerais.pdf">Clique aqui</a>
        `,
      }),
    );

    expect(result.issues).toEqual([]);
    expect(result.pagesFetched).toBe(4);
    expect(result.editions.map((edition) => edition.editionId)).toEqual([
      "PS2016",
      "PS2017",
      "PS2026",
    ]);

    for (const editionId of ["PS2016", "PS2017"]) {
      const legacy = result.editions.find((edition) => edition.editionId === editionId);
      expect(legacy?.documents.map((document) => document.role).sort()).toEqual([
        "answer-key",
        "objective-exam",
      ]);
    }

    const ps2026 = result.editions.find((edition) => edition.editionId === "PS2026");
    expect(ps2026?.documents.map((document) => document.role).sort()).toEqual([
      "answer-key",
      "answer-key-preliminary",
      "objective-exam",
    ]);
    expect(ps2026?.documents.every((document) => document.phase === "first")).toBe(true);
  });

  it("keeps the crawl fail-closed to NC/UFPR hosts and the verified year range", () => {
    expect(UFPR_OFFICIAL_RECIPE.allowedHosts).toEqual(["nc.ufpr.br"]);
    expect(UFPR_OFFICIAL_RECIPE.minYear).toBe(2016);
    expect(UFPR_OFFICIAL_RECIPE.maxYear).toBe(2026);
    expect(UFPR_OFFICIAL_RECIPE.crawl?.maxDepth).toBe(1);
    expect(UFPR_OFFICIAL_RECIPE.crawl?.maxPages).toBe(20);
  });
});
