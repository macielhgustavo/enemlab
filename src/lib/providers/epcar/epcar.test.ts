import { describe, expect, it } from "vitest";
import {
  epcarAnswerKey,
  epcarFirstPhaseQuestions,
  epcarProvider,
  epcarVariants,
  epcarYears,
} from ".";
import { compareVariantKeys, variantsForReference, variantsToIngest } from "../../catalog/variant";
import { epcarSource } from "@/lib/sources";

/**
 * A EPCAR compartilha o parser da AFA e herdou o mesmo conserto: a versão
 * anterior declarava três edições e bloqueava as outras cinco por "associação
 * prova↔gabarito não comprovada", sem que nenhum documento tivesse sido
 * aberto. Os oito gabaritos oficiais estão publicados e são legíveis.
 *
 * A diferença que vale registrar em relação à AFA está nas matérias: aqui
 * **nenhuma** edição teve a divisão em blocos confirmada contra o caderno de
 * prova, porque os cadernos da EPCAR não estão acessíveis. Isso não bloqueia
 * a ingestão, mas é dito em vez de omitido.
 */

describe("catálogo ingerido", () => {
  it("traz as oito edições lidas de documento", () => {
    // 2026 fica de fora: só o gabarito provisório está publicado, e
    // provisório pode ser retificado.
    expect(epcarYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]);
  });

  it("cada edição registra de onde os bytes foram lidos", () => {
    for (const year of epcarYears()) {
      const key = epcarAnswerKey(year)!;
      expect(key.answerKeyUrl, String(year)).toMatch(/^https:\/\/www\.fab\.mil\.br\//);
      expect(key.retrieval.route, String(year)).toBe("web-archive");
      expect(key.retrieval.sha256, String(year)).toMatch(/^[0-9a-f]{64}$/);
      expect(key.retrieval.retrievedFrom, String(year)).toContain(key.answerKeyUrl);
    }
  });

  it("todo gabarito ingerido é o final", () => {
    for (const year of epcarYears()) {
      expect(epcarAnswerKey(year)!.revision, String(year)).toBe("final");
    }
  });

  it("as anuladas conferidas no PDF estão registradas", () => {
    // 2025 é a que a versão anterior perdia: dava "C" para a questão 31,
    // que o documento oficial anula.
    expect(epcarAnswerKey(2025)!.annulled).toEqual([31]);
    expect(epcarAnswerKey(2020)!.annulled).toEqual([25, 30, 37]);
    expect(epcarAnswerKey(2021)!.annulled).toEqual([3, 23, 38, 39]);
    expect(epcarAnswerKey(2023)!.annulled).toEqual([]);
  });

  it("questão anulada chega sem gabarito", () => {
    const q31 = epcarFirstPhaseQuestions(2025).find((q) => q.number === 31)!;
    expect(q31.correctAlternative).toBeNull();
    expect(q31.alternatives.some((a) => a.isCorrect)).toBe(false);
  });
});

describe("matérias", () => {
  it("a ordem sai do documento e não segue regra", () => {
    // Sem padrão por período: 2021 tem ordem própria e 2024 volta à de 2020.
    // Qualquer regra deduzida de duas edições erraria as outras.
    const primeira = (year: number) => epcarFirstPhaseQuestions(year)[0].subject.id;
    expect(primeira(2020)).toBe("portuguese");
    expect(primeira(2021)).toBe("english");
    expect(primeira(2024)).toBe("portuguese");
    expect(primeira(2025)).toBe("english");

    const segunda = (year: number) =>
      epcarFirstPhaseQuestions(year).find((q) => q.number === 17)!.subject.id;
    expect(segunda(2021)).toBe("portuguese");
    expect(segunda(2022)).toBe("mathematics");
  });

  it("nenhuma edição teve a divisão confirmada contra o caderno", () => {
    // Declarado, não escondido: os cadernos da EPCAR não estão acessíveis.
    for (const year of epcarYears()) {
      expect(epcarAnswerKey(year)!.subjectsDerivedFrom, String(year)).toBe("answer-key-header");
      expect(epcarAnswerKey(year)!.subjectBoundariesVerified, String(year)).toBe(false);
    }
  });

  it("as matérias cobrem 1..48 sem buraco", () => {
    for (const year of epcarYears()) {
      const qs = epcarFirstPhaseQuestions(year);
      expect(qs.every((q) => q.subject.id !== "unknown"), String(year)).toBe(true);
      expect(new Set(qs.map((q) => q.number)).size, String(year)).toBe(48);
    }
  });
});

describe("versões", () => {
  it("as três versões foram lidas e discordam entre si", () => {
    for (const year of epcarYears()) {
      const key = epcarAnswerKey(year)!;
      expect(Object.keys(key.variantAnswers).sort(), String(year)).toEqual(["a", "b", "c"]);
      const numeros = (v: string) =>
        Object.fromEntries(
          Object.entries(key.variantAnswers[v]).map(([n, letra]) => [Number(n), letra]),
        );
      const { suspiciouslyIdentical } = compareVariantKeys(
        { variant: "a", answers: numeros("a") },
        { variant: "b", answers: numeros("b") },
      );
      expect(suspiciouslyIdentical, String(year)).toBe(false);
    }
  });

  it("só a canônica vira questão", () => {
    const variants = epcarVariants(2025)!;
    expect(variants.relation).toBe("reordered");
    expect(variantsToIngest(variants).map((v) => v.id)).toEqual(["a"]);
    expect(variantsForReference(variants).map((v) => v.id)).toEqual(["b", "c"]);
  });
});

describe("forma das questões", () => {
  it("monta as 48 questões de cada edição", () => {
    for (const year of epcarYears()) {
      const qs = epcarFirstPhaseQuestions(year);
      expect(qs, String(year)).toHaveLength(48);
      expect(qs.map((q) => q.number)).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
      expect(qs.every((q) => q.statementAvailable === false)).toBe(true);
      expect(qs.every((q) => q.alternatives.map((a) => a.letter).join("") === "ABCD")).toBe(true);
    }
  });

  it("a chave não colide com as outras provas", () => {
    expect(epcarProvider.questionKey(epcarFirstPhaseQuestions(2025)[47])).toBe("epcar-2025-first-48");
    expect(epcarFirstPhaseQuestions(2025)[0].providerId).toBe("epcar");
  });

  it("edição inexistente devolve lista vazia", () => {
    expect(epcarFirstPhaseQuestions(2026)).toEqual([]);
  });
});

describe("fonte", () => {
  it("declara que a leitura passa pelo arquivo público", () => {
    expect(epcarSource.retrievalRoute).toBe("web-archive");
  });

  it("os anos da fonte são os que a ingestão validou", () => {
    expect([...epcarSource.years].sort((a, b) => b - a)).toEqual(epcarYears());
  });
});
