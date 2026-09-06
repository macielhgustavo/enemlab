import { describe, expect, it } from "vitest";
import {
  getProvider,
  listProviders,
  ITA_PROVIDER_ID,
  ENEM_PROVIDER_ID,
  itaYears,
  itaAnswerKey,
  itaFirstPhaseQuestions,
  itaFirstPhaseUrl,
  itaSecondPhaseUrls,
} from "../index";
import { questionKey as enemQuestionKey } from "../../domain/classify";
import type { Question } from "../../domain/types";

describe("registry com duas provas", () => {
  it("tem ENEM e ITA registrados, e nada além disso", () => {
    expect(listProviders().map((p) => p.id).sort()).toEqual(["enem", "ita"]);
  });

  it("resolve cada provider pelo id", () => {
    expect(getProvider(ITA_PROVIDER_ID).metadata.shortLabel).toBe("ITA");
    expect(getProvider(ENEM_PROVIDER_ID).metadata.shortLabel).toBe("ENEM");
  });

  it("ITA não tem redação e declara as duas fases", () => {
    const m = getProvider(ITA_PROVIDER_ID).metadata;
    expect(m.hasEssay).toBe(false);
    expect(m.phases).toEqual(["first", "second"]);
  });
});

describe("gabaritos ingeridos", () => {
  it("só expõe edições verificadas (2019 em diante)", () => {
    const anos = itaYears();
    expect(anos.length).toBeGreaterThanOrEqual(8);
    expect(Math.min(...anos)).toBeGreaterThanOrEqual(2019);
    // O formato até 2018 numera por matéria e foi recusado na ingestão.
    expect(anos).not.toContain(2018);
  });

  it("toda edição tem numeração completa e contígua", () => {
    for (const year of itaYears()) {
      const k = itaAnswerKey(year)!;
      const cobertos = new Set([
        ...Object.keys(k.answers).map(Number),
        ...k.annulled,
      ]);
      const faltando = [];
      for (let n = 1; n <= k.total; n++) if (!cobertos.has(n)) faltando.push(n);
      expect({ year, faltando }).toEqual({ year, faltando: [] });
    }
  });

  it("as faixas de matéria cobrem a prova inteira sem sobreposição", () => {
    for (const year of itaYears()) {
      const k = itaAnswerKey(year)!;
      const faixas = Object.values(k.subjects).sort((a, b) => a[0] - b[0]);
      expect(faixas[0][0]).toBe(1);
      expect(faixas[faixas.length - 1][1]).toBe(k.total);
      for (let i = 1; i < faixas.length; i++) {
        expect(faixas[i][0]).toBe(faixas[i - 1][1] + 1);
      }
    }
  });

  it("reflete a mudança real de formato entre 2023 e 2026", () => {
    // Conferido contra os PDFs oficiais: 2023 tem 60 questões em cinco
    // matérias começando por Física; 2026 tem 48 em quatro começando por
    // Matemática. Assumir uma ordem fixa corromperia a classificação.
    const k23 = itaAnswerKey(2023)!;
    expect(k23.total).toBe(60);
    expect(k23.subjects.physics).toEqual([1, 12]);
    expect(k23.subjects.chemistry).toEqual([49, 60]);

    const k26 = itaAnswerKey(2026)!;
    expect(k26.total).toBe(48);
    expect(k26.subjects.mathematics).toEqual([1, 12]);
    expect(k26.subjects.english).toEqual([37, 48]);
  });
});

describe("questões da 1ª fase", () => {
  const qs = itaFirstPhaseQuestions(2026);

  it("gera uma questão por número da prova", () => {
    expect(qs).toHaveLength(48);
    expect(qs[0].number).toBe(1);
    expect(qs[47].number).toBe(48);
  });

  it("traz o gabarito oficial e classifica a matéria pela faixa", () => {
    // Lido diretamente do PDF oficial de 2026.
    expect(qs[0].correctAlternative).toBe("D");
    expect(qs[0].subject.id).toBe("mathematics");
    expect(qs[12].correctAlternative).toBe("B");
    expect(qs[12].subject.id).toBe("physics");
  });

  it("questão anulada não tem gabarito, para não contar como erro", () => {
    const anulada = qs.find((q) => q.number === 6)!;
    expect(anulada.correctAlternative).toBeNull();
    expect(anulada.alternatives.every((a) => !a.isCorrect)).toBe(true);
  });

  it("declara que o enunciado não está disponível e aponta a fonte oficial", () => {
    const q = qs[0];
    expect(q.statementAvailable).toBe(false);
    expect(q.context).toBeNull();
    expect(q.official).toMatchObject({ official: true, institution: "ITA" });
    expect(q.official!.documentUrl).toBe(itaFirstPhaseUrl(2026));
  });

  it("oferece as cinco alternativas para marcação", () => {
    expect(qs[0].alternatives.map((a) => a.letter)).toEqual(["A", "B", "C", "D", "E"]);
    expect(qs[0].alternatives.every((a) => a.text === null)).toBe(true);
  });

  it("marca inglês com idioma para não se confundir com as demais", () => {
    const ingles = qs.find((q) => q.subject.id === "english")!;
    expect(ingles.language).toBe("ingles");
  });
});

describe("chaves de questão", () => {
  it("ITA e ENEM não colidem", () => {
    const ita = getProvider(ITA_PROVIDER_ID);
    const chaveIta = ita.questionKey(itaFirstPhaseQuestions(2026)[0]);
    const chaveEnem = enemQuestionKey({
      year: 2026,
      index: 1,
      language: null,
      discipline: "matematica",
    } as Question);
    expect(chaveIta).toBe("ita-2026-first-1");
    expect(chaveIta).not.toBe(chaveEnem);
  });

  it("a chave distingue ano e número dentro do próprio ITA", () => {
    const ita = getProvider(ITA_PROVIDER_ID);
    const a = ita.questionKey(itaFirstPhaseQuestions(2026)[0]);
    const b = ita.questionKey(itaFirstPhaseQuestions(2025)[0]);
    const c = ita.questionKey(itaFirstPhaseQuestions(2026)[1]);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("2ª fase", () => {
  it("expõe as provas por matéria com URL oficial", () => {
    const urls = itaSecondPhaseUrls(2026);
    expect(urls.map((u) => u.subject)).toEqual([
      "mathematics",
      "physics",
      "chemistry",
      "portuguese",
    ]);
    expect(urls[0].url).toBe("https://www.vestibular.ita.br/provas/matematica_2026_2f.pdf");
  });
});
