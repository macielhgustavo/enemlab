import { describe, expect, it } from "vitest";
import {
  UNCLASSIFIED,
  UNIVERSAL_TAXONOMY,
  acceptClassification,
  isUniversalTopic,
  isUniversalDiscipline,
  isWithinTopic,
  universalSubtree,
  universalTopicLabel,
  universalTopicPath,
} from "./universal";
import { areasOf } from "@/lib/providers/taxonomy";

/**
 * Duas taxonomias, de propósito.
 *
 * A do provider é o vocabulário da banca e não pode ser traduzida — o mapa
 * de domínio depende dela. A universal existe para o aluno que quer treinar
 * "circuitos" sem escolher a banca antes.
 */

describe("árvore universal", () => {
  it("os ids são hierárquicos e coerentes com o pai", () => {
    const conferir = (nos: typeof UNIVERSAL_TAXONOMY, prefixo = "") => {
      for (const n of nos) {
        if (prefixo) expect(n.id.startsWith(prefixo + ".")).toBe(true);
        expect(n.label.length).toBeGreaterThan(0);
        if (n.children) conferir(n.children, n.id);
      }
    };
    conferir(UNIVERSAL_TAXONOMY);
  });

  it("não passa de três níveis", () => {
    // Uma taxonomia funda fica impossível de classificar com confiança e
    // ninguém navega até o fim.
    const profundidade = (nos: typeof UNIVERSAL_TAXONOMY): number =>
      Math.max(...nos.map((n) => (n.children ? 1 + profundidade(n.children) : 1)));
    expect(profundidade(UNIVERSAL_TAXONOMY)).toBeLessThanOrEqual(3);
  });

  it("nenhum id se repete", () => {
    const ids: string[] = [];
    const anda = (nos: typeof UNIVERSAL_TAXONOMY) => {
      for (const n of nos) {
        ids.push(n.id);
        if (n.children) anda(n.children);
      }
    };
    anda(UNIVERSAL_TAXONOMY);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reconhece tópico existente e recusa inventado", () => {
    expect(isUniversalTopic("physics.electricity.circuits")).toBe(true);
    expect(isUniversalTopic("physics.electricity.wormholes")).toBe(false);
  });

  it("a disciplina raiz não é um tópico atribuível", () => {
    // Marcar uma questão como "física" não diz nada que a matéria do
    // provider já não diga — e a raiz colide com o vocabulário de algumas
    // bancas, o que tornaria um id solto ambíguo.
    expect(isUniversalDiscipline("physics")).toBe(true);
    expect(isUniversalTopic("physics")).toBe(false);
  });

  it("monta o caminho legível", () => {
    expect(universalTopicPath("physics.electricity.circuits")).toEqual([
      "Física",
      "Eletricidade",
      "Circuitos",
    ]);
  });

  it("devolve o id cru quando não conhece o rótulo", () => {
    expect(universalTopicLabel("physics.quantum.strings")).toBe("physics.quantum.strings");
  });

  it("a subárvore permite treinar um ramo inteiro", () => {
    const ramo = universalSubtree("physics.electricity");
    expect(ramo).toContain("physics.electricity");
    expect(ramo).toContain("physics.electricity.circuits");
    expect(ramo).not.toContain("physics.mechanics.dynamics");
  });

  it("pertencimento a ramo não casa por prefixo de texto", () => {
    expect(isWithinTopic("physics.electricity.circuits", "physics.electricity")).toBe(true);
    // "physics.electricityXYZ" começa com o texto mas não é do ramo.
    expect(isWithinTopic("physics.electricityXYZ", "physics.electricity")).toBe(false);
  });
});

describe("classificação honesta", () => {
  it("confiança baixa vira não classificado", () => {
    // §26: não fingir tópico preciso. Questão marcada errado polui o treino
    // por conteúdo de quem confiou nele.
    expect(
      acceptClassification({ topic: "physics.electricity.circuits", confidence: "baixa", evidence: [] }),
    ).toEqual(UNCLASSIFIED);
  });

  it("tópico inexistente vira não classificado", () => {
    expect(
      acceptClassification({ topic: "physics.inventado", confidence: "alta", evidence: ["x"] }),
    ).toEqual(UNCLASSIFIED);
  });

  it("classificação sustentada passa", () => {
    const c = {
      topic: "physics.electricity.circuits",
      confidence: "alta" as const,
      evidence: ["resistor", "corrente"],
    };
    expect(acceptClassification(c)).toEqual(c);
  });
});

describe("as duas taxonomias convivem", () => {
  it("a universal não substitui a do provider", () => {
    // O ITA continua com "physics"; o ENEM com "ciencias-natureza". Traduzir
    // um no outro apagaria a leitura por banca.
    expect(areasOf("ita").map((a) => a.id)).toContain("physics");
    expect(areasOf("enem").map((a) => a.id)).toContain("ciencias-natureza");
  });

  it("nenhuma área de provider é tópico universal atribuível", () => {
    // O ITA chama sua matéria de "physics", igual à raiz da universal. A
    // regra de dois níveis é o que impede um id solto de ser ambíguo entre
    // as duas taxonomias.
    for (const p of ["ita", "enem"]) {
      for (const a of areasOf(p)) {
        expect(isUniversalTopic(a.id)).toBe(false);
      }
    }
  });

  it("a colisão nas raízes é conhecida e documentada", () => {
    // Não é acidente: as duas taxonomias usam o nome natural da disciplina.
    // O teste existe para que, se alguém tornar a raiz atribuível, saiba o
    // que está quebrando.
    expect(isUniversalDiscipline("physics")).toBe(true);
    expect(areasOf("ita").map((a) => a.id)).toContain("physics");
  });
});
