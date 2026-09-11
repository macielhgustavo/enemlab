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
  it("harvests current, intermediate PS2021 and legacy layouts", async () => {
    const archive = UFPR_OFFICIAL_RECIPE.archiveUrls[0];
    const modern2026 =
      "https://servicos.nc.ufpr.br/PortalNC/Concurso?concurso=PS2026";
    const modern2024 =
      "https://servicos.nc.ufpr.br/PortalNC/Concurso?concurso=PS2024";
    const modern2021 =
      "https://servicos.nc.ufpr.br/PortalNC/Concurso?concurso=PS2021";
    const directory2021 =
      "https://servicos.nc.ufpr.br/documentos/PS2021/provas1fase/";
    const legacy2017 =
      "https://www.nc.ufpr.br/concursos_institucionais/ufpr/ps2017/index.htm";

    const result = await harvestOfficialSource(
      UFPR_OFFICIAL_RECIPE,
      routeFetcher({
        [archive]: `
          <a href="${modern2026}">PS 2025/2026</a>
          <a href="${modern2024}">PS 2023/2024</a>
          <a href="${modern2021}">PS 2020/2021</a>
          <a href="${legacy2017}">PS 2016/2017</a>
        `,
        [modern2026]: `
          <a href="/documentos/ps2026/provas/provisorio/Geral.pdf">Provisório</a>
          <a href="/documentos/ps2026/provas/definitivo/Geral.pdf">Definitivo</a>
        `,
        [modern2024]: `
          <a href="/documentos/ps2024/provas/Geral.pdf">Prova e gabarito definitivo</a>
        `,
        [modern2021]: `<a href="${directory2021}">Provas da primeira fase</a>`,
        [directory2021]: `
          <a href="ps2021_conhecimentos_gerais_ingles.pdf">Inglês</a>
          <a href="ps2021_conhecimentos_gerais_frances.pdf">Francês</a>
        `,
        [legacy2017]: `
          <a href="/concursos_institucionais/ufpr/ps2017/provas1fase/PS2017_conhecimentos_gerais.pdf">Definitivo</a>
        `,
      }),
    );

    expect(result.issues).toEqual([]);
    expect(result.pagesFetched).toBe(6);
    expect(result.editions.map((edition) => edition.editionId)).toEqual([
      "PS2017",
      "PS2021",
      "PS2024",
      "PS2026",
    ]);

    const ps2021 = result.editions.find((edition) => edition.editionId === "PS2021");
    expect(ps2021?.documents).toHaveLength(4);
    expect(
      [...new Set(ps2021?.documents.map((document) => document.variant))].sort(),
    ).toEqual(["english", "french"]);

    const ps2024 = result.editions.find((edition) => edition.editionId === "PS2024");
    expect(ps2024?.documents.map((document) => document.role).sort()).toEqual([
      "answer-key",
      "objective-exam",
    ]);

    const ps2026 = result.editions.find((edition) => edition.editionId === "PS2026");
    expect(ps2026?.documents.map((document) => document.role).sort()).toEqual([
      "answer-key",
      "answer-key-preliminary",
      "objective-exam",
    ]);
  });

  it("keeps the crawl bounded to the verified UFPR window", () => {
    expect(UFPR_OFFICIAL_RECIPE.allowedHosts).toEqual(["nc.ufpr.br"]);
    expect(UFPR_OFFICIAL_RECIPE.minYear).toBe(2016);
    expect(UFPR_OFFICIAL_RECIPE.maxYear).toBe(2026);
    expect(UFPR_OFFICIAL_RECIPE.crawl?.maxDepth).toBe(2);
    expect(UFPR_OFFICIAL_RECIPE.crawl?.maxPages).toBe(25);
  });
});
