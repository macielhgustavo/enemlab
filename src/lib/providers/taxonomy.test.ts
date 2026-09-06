import { describe, expect, it } from "vitest";
import { areaLabel, areasOf, providerHasArea } from "./taxonomy";

// As telas liam AREA_ORDER/AREA_LABELS do ENEM direto. O painel do ITA
// listava as quatro áreas do ENEM zeradas, e o runner tinha a própria cópia
// dos nomes das matérias do ITA.

describe("taxonomia por prova", () => {
  it("cada prova declara a própria divisão de conteúdo", () => {
    expect(areasOf("enem").map((a) => a.id)).toEqual([
      "matematica",
      "ciencias-natureza",
      "linguagens",
      "ciencias-humanas",
    ]);
    expect(areasOf("ita").map((a) => a.id)).toContain("physics");
  });

  it("as duas taxonomias não se cruzam", () => {
    const enem = new Set(areasOf("enem").map((a) => a.id));
    for (const a of areasOf("ita")) expect(enem.has(a.id)).toBe(false);
  });

  it("prova ausente resolve para o ENEM, como o resto do app", () => {
    expect(areasOf(null)).toEqual(areasOf("enem"));
  });

  it("prova desconhecida devolve lista vazia em vez de áreas de outra banca", () => {
    expect(areasOf("fuvest")).toEqual([]);
  });
});

describe("rótulo de área", () => {
  it("traduz na taxonomia da prova", () => {
    expect(areaLabel("physics", "ita")).toBe("Física");
    expect(areaLabel("ciencias-natureza", "enem")).toBe("Ciências da Natureza");
  });

  it("acha o rótulo mesmo sem saber a prova", () => {
    // O Histórico mistura bancas de propósito e ainda precisa nomear a linha.
    expect(areaLabel("physics")).toBe("Física");
    expect(areaLabel("linguagens")).toBe("Linguagens");
  });

  it("procura em outras provas quando a prova indicada não conhece a área", () => {
    expect(areaLabel("physics", "enem")).toBe("Física");
  });

  it("devolve o id cru em vez de inventar nome", () => {
    expect(areaLabel("biotecnologia", "enem")).toBe("biotecnologia");
    expect(areaLabel("")).toBe("");
  });
});

describe("pertencimento de área", () => {
  it("responde se a prova conhece aquela área", () => {
    expect(providerHasArea("ita", "physics")).toBe(true);
    expect(providerHasArea("ita", "linguagens")).toBe(false);
    expect(providerHasArea("enem", "linguagens")).toBe(true);
    expect(providerHasArea("enem", "physics")).toBe(false);
  });
});
