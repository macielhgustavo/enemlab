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
  unicampImporter,
  unicampSource,
  uelImporter,
  uelSource,
  pucSpImporter,
  pucSpSource,
  pucRioImporter,
  pucRioSource,
  udescImporter,
  udescSource,
  acafeImporter,
  acafeSource,
} from "./index";

describe("registry de fontes", () => {
  it("registra as fontes desta versão, e nada além", () => {
    expect(listSources().map((s) => s.id).sort()).toEqual([
      "acafe-official-archive",
      "afa-official-archive",
      "eear-research",
      "enem-dev",
      "epcar-official-archive",
      "fuvest-archive",
      "ime-cfg-archive",
      "inep-official-archive",
      "ita-official-archive",
      "mackenzie-research",
      "puc-pr-research",
      "puc-rio-official-repository",
      "puc-sp-nucvest-archive",
      "udesc-official-archive",
      "uel-cops-archive",
      "uem-cvu-research",
      "uepg-cps-research",
      "ufpr-research",
      "ufrj-historical-research",
      "ufsc-coperve-research",
      "unesp-vunesp-research",
      "unicamp-comvest-archive",
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
    expect(sourcesForProvider("unicamp").map((s) => s.id)).toEqual(["unicamp-comvest-archive"]);
    expect(sourcesForProvider("uel").map((s) => s.id)).toEqual(["uel-cops-archive"]);
    expect(sourcesForProvider("puc-sp").map((s) => s.id)).toEqual(["puc-sp-nucvest-archive"]);
    expect(sourcesForProvider("puc-rio").map((s) => s.id)).toEqual(["puc-rio-official-repository"]);
    expect(sourcesForProvider("udesc").map((s) => s.id)).toEqual(["udesc-official-archive"]);
    expect(sourcesForProvider("acafe").map((s) => s.id)).toEqual(["acafe-official-archive"]);
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
    for (const id of [
      "eear-research",
      "mackenzie-research",
      "puc-pr-research",
      "uem-cvu-research",
      "uepg-cps-research",
      "ufpr-research",
      "ufrj-historical-research",
      "ufsc-coperve-research",
      "unesp-vunesp-research",
    ]) {
      const source = getSource(id);
      expect(source.status).toBe("blocked");
      expect(source.years).toEqual([]);
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

  it("descreve os novos vestibulares aceitos como referência oficial", () => {
    for (const source of [unicampSource, uelSource, pucSpSource, pucRioSource, udescSource, acafeSource]) {
      expect(source).toMatchObject({
        statementMode: "reference-only",
        sourceType: "pdf-reference",
        family: "university",
        status: "active",
        rightsStatus: "official-reference",
      });
      expect(source.years.length).toBeGreaterThan(0);
    }
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
    expect(importerForProvider("unicamp")?.sourceId).toBe("unicamp-comvest-archive");
    expect(importerForProvider("uel")?.sourceId).toBe("uel-cops-archive");
    expect(importerForProvider("puc-sp")?.sourceId).toBe("puc-sp-nucvest-archive");
    expect(importerForProvider("puc-rio")?.sourceId).toBe("puc-rio-official-repository");
    expect(importerForProvider("udesc")?.sourceId).toBe("udesc-official-archive");
    expect(importerForProvider("acafe")?.sourceId).toBe("acafe-official-archive");
    // Prova futura ainda não tem importador: null é honesto, não um chute.
    expect(importerForProvider("ufpr")).toBeNull();
  });

  it("anos do importador batem com os da fonte", () => {
    expect(itaImporter.availableYears()).toEqual(itaSource.years);
    expect(afaImporter.availableYears()).toEqual(afaSource.years);
    expect(epcarImporter.availableYears()).toEqual(epcarSource.years);
    expect(unicampImporter.availableYears()).toEqual(unicampSource.years);
    expect(uelImporter.availableYears()).toEqual(uelSource.years);
    expect(pucSpImporter.availableYears()).toEqual(pucSpSource.years);
    expect(pucRioImporter.availableYears()).toEqual(pucRioSource.years);
    expect(udescImporter.availableYears()).toEqual(udescSource.years);
    expect(acafeImporter.availableYears()).toEqual(acafeSource.years);
  });

  it("aponta a prova oficial para os novos providers", () => {
    expect(unicampImporter.provenanceFor(2025).documentUrl).toContain("comvest.unicamp.br");
    expect(uelImporter.provenanceFor(2026).documentUrl).toContain("cops.uel.br");
    expect(pucSpImporter.provenanceFor(2026).documentUrl).toContain("nucvest.com.br");
    expect(pucRioImporter.provenanceFor(2026).documentUrl).toContain("puc-rio.br");
    expect(udescImporter.provenanceFor(2026, "morning").documentUrl).toContain("udesc.br");
    expect(acafeImporter.provenanceFor(2026).documentUrl).toContain("acafe.org.br");
  });

  it("aponta a chave final oficial para cada provider FAB", () => {
    expect(afaImporter.provenanceFor(2025).documentUrl).toContain("afa2025_gab_oficial.pdf");
    expect(epcarImporter.provenanceFor(2025).documentUrl).toContain("cpcar2025_gab_oficial.pdf");
  });

  it("ano sem edição aponta o arquivo da instituição, não uma URL montada", () => {
    // 2026 é o caso concreto: a AFA aplicou a prova, mas o gabarito final não
    // está acessível para leitura. A versão anterior declarava uma URL para
    // ela mesmo assim.
    expect(afaImporter.provenanceFor(2026).documentUrl).toBe(afaSource.archiveUrl);
  });

  it("as fontes FAB declaram que a leitura passa pelo arquivo público", () => {
    // A FAB responde 403 a cliente automatizado, e a ingestão lê a cópia
    // datada. Sem este campo o audit trataria o 403 como quebra — foi o que
    // deixou a varredura anterior terminando em falha externa.
    expect(afaSource.retrievalRoute).toBe("web-archive");
    expect(epcarSource.retrievalRoute).toBe("web-archive");
  });
});
