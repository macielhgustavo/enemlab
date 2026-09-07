import { describe, expect, it } from "vitest";
import {
  enemImporter,
  enemSource,
  getSource,
  importerForProvider,
  itaImporter,
  itaSource,
  listSources,
  sourcesForProvider,
  afaImporter,
  afaSource,
  epcarImporter,
  epcarSource,
} from "./index";

describe("registry de fontes", () => {
  it("registra as nove fontes desta versão, e nada além", () => {
    expect(listSources().map((s) => s.id).sort()).toEqual([
      "afa-official-archive",
      "eear-research",
      "enem-dev",
      "epcar-official-archive",
      "fuvest-archive",
      "ime-cfg-archive",
      "inep-official-archive",
      "ita-official-archive",
      "ufpr-research",
    ]);
  });

  it("resolve fonte por id e falha alto no desconhecido", () => {
    expect(getSource("ita-official-archive").institution).toBe("ITA");
    expect(() => getSource("fuvest")).toThrow(/não registrada/i);
  });

  it("liga fonte ao provider que a consome", () => {
    expect(sourcesForProvider("ita").map((s) => s.id)).toEqual(["ita-official-archive"]);
    expect(sourcesForProvider("ime").map((s) => s.id)).toEqual(["ime-cfg-archive"]);
    expect(sourcesForProvider("fuvest").map((s) => s.id)).toEqual(["fuvest-archive"]);
    expect(sourcesForProvider("afa").map((s) => s.id)).toEqual(["afa-official-archive"]);
    expect(sourcesForProvider("epcar").map((s) => s.id)).toEqual(["epcar-official-archive"]);
  });

  it("um provider pode ter mais de uma fonte", () => {
    // §15: o ENEM tem a API estruturada (2009–2023, com enunciado) e o
    // arquivo do INEP (1998–2025, em PDF). São origens diferentes da mesma
    // prova, e o registry precisa suportar as duas.
    expect(sourcesForProvider("enem").map((s) => s.id).sort()).toEqual([
      "enem-dev",
      "inep-official-archive",
    ]);
  });

  it("fonte registrada mas não ingerida não promete edição", () => {
    // Declarar 1998–2025 aqui faria o app oferecer prova que não tem.
    const inep = listSources().find((s) => s.id === "inep-official-archive")!;
    expect(inep.years).toEqual([]);
    expect(inep.parserVersion).toContain("nao-ingerido");
  });

  it("descreve a diferença real entre as duas fontes", () => {
    // O ENEM entrega conteúdo estruturado; o ITA, só referência.
    expect(enemSource.statementMode).toBe("structured");
    expect(enemSource.sourceType).toBe("structured-api");

    expect(itaSource.statementMode).toBe("reference-only");
    expect(itaSource.sourceType).toBe("pdf-reference");
    expect(itaSource.extractionMethod).toBe("pdf-text-layer");
  });

  it("não promete resolução oficial que o ITA não publica", () => {
    expect(itaSource.answerKeyAvailable).toBe(true);
    expect(itaSource.expectedAnswersAvailable).toBe(false);
  });

  it("só declara as edições que a ingestão validou", () => {
    expect(itaSource.years.length).toBeGreaterThanOrEqual(8);
    expect(Math.min(...itaSource.years)).toBeGreaterThanOrEqual(2019);
    // Formato antigo foi recusado: não pode aparecer como disponível.
    expect(itaSource.years).not.toContain(2018);
  });

  it("mantém pesquisa bloqueada fora dos providers executáveis", () => {
    for (const id of ["ufpr-research", "eear-research"]) {
      const source = getSource(id);
      expect(source.status).toBe("blocked");
      expect(source.years).toEqual([]);
      expect(source.answerKeyAvailable).toBe(false);
    }
  });

  it("descreve as fontes FAB como referência oficial", () => {
    expect(afaSource).toMatchObject({
      institution: "FAB",
      statementMode: "reference-only",
      family: "air-force",
      status: "active",
    });
    expect(epcarSource).toMatchObject({
      institution: "FAB",
      statementMode: "reference-only",
      family: "air-force",
      status: "active",
    });
  });
});

describe("procedência", () => {
  it("responde de onde veio o item do ITA", () => {
    const p = itaImporter.provenanceFor(2026);
    expect(p).toMatchObject({
      providerId: "ita",
      sourceId: "ita-official-archive",
      institution: "ITA",
      official: true,
    });
    expect(p.documentUrl).toBe("https://www.vestibular.ita.br/provas/2026_fase1.pdf");
    expect(p.parserVersion).toMatch(/^ita-answer-key@/);
    expect(p.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("distingue 1ª e 2ª fase no documento apontado", () => {
    const primeira = itaImporter.provenanceFor(2026, "first");
    const segunda = itaImporter.provenanceFor(2026, "second");
    expect(primeira.documentUrl).not.toBe(segunda.documentUrl);
    expect(segunda.documentUrl).toContain("_2f.pdf");
  });

  it("guarda a página quando conhecida", () => {
    expect(itaImporter.provenanceFor(2026, "first", 5).page).toBe(5);
    expect(itaImporter.provenanceFor(2026).page).toBeUndefined();
  });

  it("o ENEM também responde procedência", () => {
    const p = enemImporter.provenanceFor(2023);
    expect(p.sourceId).toBe("enem-dev");
    expect(p.documentUrl).toContain("2023");
  });

  it("importador é resolvido pelo provider", () => {
    expect(importerForProvider("ita")?.sourceId).toBe("ita-official-archive");
    expect(importerForProvider("enem")?.sourceId).toBe("enem-dev");
    expect(importerForProvider("fuvest")?.sourceId).toBe("fuvest-archive");
    expect(importerForProvider("afa")?.sourceId).toBe("afa-official-archive");
    expect(importerForProvider("epcar")?.sourceId).toBe("epcar-official-archive");
    // Prova futura ainda não tem importador: null é honesto, não um chute.
    expect(importerForProvider("ufpr")).toBeNull();
  });

  it("anos do importador batem com os da fonte", () => {
    expect(itaImporter.availableYears()).toEqual(itaSource.years);
    expect(afaImporter.availableYears()).toEqual(afaSource.years);
    expect(epcarImporter.availableYears()).toEqual(epcarSource.years);
  });

  it("aponta a chave final oficial para cada provider FAB", () => {
    expect(afaImporter.provenanceFor(2026).documentUrl).toContain("afa2026-P1-gabarito-oficial.pdf");
    expect(epcarImporter.provenanceFor(2025).documentUrl).toContain("PROVA_CPCAR_2025_versao_A.pdf");
  });
});
