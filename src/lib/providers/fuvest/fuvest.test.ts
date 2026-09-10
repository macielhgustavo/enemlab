import { describe, expect, it } from "vitest";
import {
  FUVEST_PROVIDER_ID,
  fuvestAnswerKey,
  fuvestFirstPhaseQuestions,
  fuvestMetadata,
  fuvestQuestionKey,
  fuvestSecondPhaseUrls,
  fuvestVariants,
  fuvestYears,
} from "./index";
import { listProviders, sameProvider } from "@/lib/providers";
import { fuvestSource, importerForProvider } from "@/lib/sources";
import { variantsForReference, variantsToIngest } from "@/lib/catalog/variant";

/**
 * Primeira prova com variantes no catálogo. É por causa dela que o
 * `ExamVariant` veio antes desta wave.
 */

describe("catálogo ingerido", () => {
  it("traz só as edições lidas por inteiro", () => {
    expect(fuvestYears()).toEqual(Array.from({ length: 22 }, (_, index) => 2026 - index));
  });

  it("respeita a mudança histórica de 100 para 90 questões", () => {
    for (const ano of fuvestYears()) {
      expect(fuvestAnswerKey(ano)!.total, String(ano)).toBe(ano <= 2006 ? 100 : 90);
    }
  });

  it("tem cobertura contígua, incluindo anuladas", () => {
    for (const ano of fuvestYears()) {
      const k = fuvestAnswerKey(ano)!;
      for (let n = 1; n <= k.total; n++) {
        const letra = k.answers[String(n)];
        expect(Boolean(letra) || k.annulled.includes(n), `${ano} q${n}`).toBe(true);
        if (letra) expect(["A", "B", "C", "D", "E"]).toContain(letra);
      }
    }
    expect(fuvestYears().flatMap((ano) => fuvestAnswerKey(ano)!.annulled)).toHaveLength(4);
  });
});

describe("variantes", () => {
  it("os nomes vêm do documento, não do código", () => {
    // 2025 usa V1..V4; 2024 usa V, K, Q, X, Z. Fixar a lista faria o parser
    // recusar o ano em que a banca mudasse — ou atribuir a resposta errada.
    expect(fuvestVariants(2025)!.variants.map((v) => v.id)).toEqual(["v1", "v2", "v3", "v4"]);
    expect(fuvestVariants(2024)!.variants.map((v) => v.id)).toEqual(["v", "k", "q", "x", "z"]);
  });

  it("são declaradas como reordenação", () => {
    for (const ano of fuvestYears()) {
      expect(fuvestVariants(ano)!.relation, String(ano)).toBe("reordered");
    }
  });

  it("só a canônica vira questão; as demais ficam como referência", () => {
    // Ingerir as cinco de 2024 criaria 450 entradas para 90 questões, e o
    // SRS trataria a mesma questão como cinco.
    const v = fuvestVariants(2024)!;
    expect(variantsToIngest(v).map((x) => x.id)).toEqual(["v"]);
    expect(variantsForReference(v).map((x) => x.id)).toEqual(["k", "q", "x", "z"]);
  });

  it("a variante não entra na chave da questão", () => {
    const q = fuvestFirstPhaseQuestions(2024)[0];
    expect(fuvestQuestionKey(q)).toBe("fuvest-2024-first-1");
    expect(fuvestQuestionKey(q)).not.toMatch(/-[vkqxz]-/);
  });

  it("gabarito retificado é reconhecido como tal", () => {
    // §10: a retificação vence o publicado antes.
    expect(fuvestAnswerKey(2024)!.revision).toBe("rectified");
    expect(fuvestAnswerKey(2026)!.revision).toBe("rectified");
    expect(fuvestAnswerKey(2025)!.revision).toBe("final");
  });
});

describe("questões", () => {
  const qs = fuvestFirstPhaseQuestions(2025);

  it("monta as 90 questões", () => {
    expect(qs).toHaveLength(90);
    expect(qs.at(-1)!.number).toBe(90);
  });

  it("não reproduz enunciado e leva ao documento oficial", () => {
    for (const q of qs) {
      expect(q.statementAvailable).toBe(false);
      expect(q.official?.institution).toBe("FUVEST");
      expect(q.official?.documentUrl).toMatch(/^https:\/\/www\.fuvest\.br\//);
    }
  });

  it("a 1ª fase é de conhecimentos gerais, sem matéria inventada", () => {
    // O gabarito não separa por matéria; declarar uma seria classificação
    // inventada.
    expect(new Set(qs.map((q) => q.subject.id))).toEqual(new Set(["conhecimentos-gerais"]));
  });

  it("ano não ingerido devolve lista vazia", () => {
    expect(fuvestFirstPhaseQuestions(2004)).toEqual([]);
  });
});

describe("isolamento", () => {
  it("não colide com as outras provas", () => {
    const q = fuvestFirstPhaseQuestions(2025)[0];
    expect(fuvestQuestionKey(q).startsWith("fuvest-")).toBe(true);
    expect(sameProvider("fuvest", "enem")).toBe(false);
    expect(sameProvider("fuvest", "ime")).toBe(false);
  });

  it("está registrada como prova de universidade", () => {
    expect(fuvestSource.family).toBe("university");
    expect(fuvestSource.providerId).toBe(FUVEST_PROVIDER_ID);
    expect(listProviders().map((p) => p.id)).toContain("fuvest");
  });

  it("só a 1ª fase é executável", () => {
    expect(fuvestMetadata.phases).toEqual(["first"]);
    expect(fuvestSource.phases).toContain("second");
    expect(fuvestSecondPhaseUrls(2025).length).toBeGreaterThan(0);
  });

  it("não promete correção de discursiva", () => {
    // A FUVEST publica respostas esperadas, mas não há corretor — declarar
    // disponibilidade prometeria correção que não existe.
    expect(fuvestSource.expectedAnswersAvailable).toBe(false);
    expect(fuvestMetadata.hasEssay).toBe(false);
  });

  it("o importador aponta o documento certo", () => {
    const imp = importerForProvider("fuvest")!;
    expect(imp.availableYears()).toEqual(fuvestYears());
    expect(imp.provenanceFor(2025).documentUrl).toContain("fuvest.br");
  });
});
