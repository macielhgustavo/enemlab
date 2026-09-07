import { describe, expect, it } from "vitest";
import {
  IME_PROVIDER_ID,
  imeAnswerKey,
  imeEditionOfYear,
  imeEditions,
  imeExamUrl,
  imeMetadata,
  imeObjectiveQuestions,
  imeQuestionKey,
  imeYears,
} from "./index";
import { getProvider, listProviders, sameProvider } from "@/lib/providers";
import { areaLabel, areasOf } from "@/lib/providers/taxonomy";
import { imeSource, importerForProvider, listSources } from "@/lib/sources";

/**
 * O IME entra em modo referência como o ITA, mas por outro motivo — e a
 * diferença é o que estes testes registram para a próxima prova.
 *
 * O ITA é digitalizado: não há texto. O IME tem camada de texto, mas ela
 * quebra a matemática. "O PDF tem texto" não é o critério; o critério é se
 * o texto preserva o significado.
 */

describe("catálogo ingerido", () => {
  it("traz as oito edições do formato atual", () => {
    expect(imeEditions()).toHaveLength(8);
    expect(imeEditions()[0]).toBe("2025-2026");
    expect(imeEditions().at(-1)).toBe("2018-2019");
  });

  it("a estrutura da objetiva é a mesma em todas as edições", () => {
    // Conferido contra os PDFs: 40 questões, 15 matemática, 15 física,
    // 10 química. Se uma edição futura mudar isso, este teste avisa antes
    // de o número errado aparecer na tela.
    for (const ed of imeEditions()) {
      const k = imeAnswerKey(ed)!;
      expect(k.total, ed).toBe(40);
      expect(k.subjects.mathematics, ed).toHaveLength(15);
      expect(k.subjects.physics, ed).toHaveLength(15);
      expect(k.subjects.chemistry, ed).toHaveLength(10);
    }
  });

  it("todo gabarito ingerido é o final, nunca o preliminar", () => {
    // §9: o preliminar pode ser retificado. Corrigir prova com resposta
    // revogada é o defeito que esta regra existe para impedir.
    for (const ed of imeEditions()) {
      expect(imeAnswerKey(ed)!.revision, ed).toBe("final");
    }
  });

  it("cada questão tem resposta ou está anulada, sem buraco", () => {
    for (const ed of imeEditions()) {
      const k = imeAnswerKey(ed)!;
      for (let n = 1; n <= k.total; n++) {
        const temResposta = k.answers[String(n)] !== undefined;
        const anulada = k.annulled.includes(n);
        expect(temResposta || anulada, `${ed} questão ${n}`).toBe(true);
        // Anulada com resposta significa que uma das duas leituras está
        // errada, e não há como saber qual.
        expect(temResposta && anulada, `${ed} questão ${n}`).toBe(false);
      }
    }
  });

  it("só usa letras que a prova aceita", () => {
    for (const ed of imeEditions()) {
      for (const letra of Object.values(imeAnswerKey(ed)!.answers)) {
        expect(["A", "B", "C", "D", "E"]).toContain(letra);
      }
    }
  });

  it("as anuladas existentes são reais e vêm dos documentos", () => {
    // Conferidas à mão contra os PDFs: 2025-2026 anula a 40, 2021-2022
    // anula a 1 e a 29, 2018-2019 não anula nenhuma.
    expect(imeAnswerKey("2025-2026")!.annulled).toEqual([40]);
    expect(imeAnswerKey("2021-2022")!.annulled).toEqual([1, 29]);
    expect(imeAnswerKey("2018-2019")!.annulled).toEqual([]);
  });
});

describe("questões objetivas", () => {
  const qs = imeObjectiveQuestions("2025-2026");

  it("monta as 40 questões da edição", () => {
    expect(qs).toHaveLength(40);
    expect(qs[0].number).toBe(1);
    expect(qs.at(-1)!.number).toBe(40);
  });

  it("não reproduz enunciado", () => {
    // O motivo está no cabeçalho do provider: a extração quebra a
    // matemática, e uma fórmula errada é pior que fórmula nenhuma.
    for (const q of qs) {
      expect(q.statementAvailable).toBe(false);
      expect(q.context).toBeNull();
      expect(q.alternatives.every((a) => a.text === null)).toBe(true);
    }
  });

  it("leva ao documento oficial do IME", () => {
    for (const q of qs) {
      expect(q.official?.institution).toBe("IME");
      expect(q.official?.documentUrl).toMatch(/^https:\/\/www\.ime\.eb\.mil\.br\//);
    }
  });

  it("a anulada chega sem gabarito, para não contar como erro", () => {
    const q40 = qs.find((q) => q.number === 40)!;
    expect(q40.correctAlternative).toBeNull();
    expect(q40.alternatives.some((a) => a.isCorrect)).toBe(false);
  });

  it("cada questão sabe sua matéria", () => {
    expect(qs.find((q) => q.number === 1)!.subject.id).toBe("mathematics");
    expect(qs.find((q) => q.number === 20)!.subject.id).toBe("physics");
    expect(qs.find((q) => q.number === 35)!.subject.id).toBe("chemistry");
    expect(qs.every((q) => q.subject.id !== "unknown")).toBe(true);
  });

  it("edição inexistente devolve lista vazia, não erro nem invenção", () => {
    expect(imeObjectiveQuestions("1999-2000")).toEqual([]);
  });
});

describe("isolamento entre provas", () => {
  it("a chave do IME não colide com ITA nem ENEM", () => {
    const q = imeObjectiveQuestions("2025-2026")[0];
    const chave = imeQuestionKey(q);
    expect(chave).toBe("ime-2025-2026-objective-1");
    expect(chave.startsWith("ime-")).toBe(true);
    expect(chave).not.toMatch(/^ita-|^enem/);
  });

  it("a matéria do IME é a mesma palavra do ITA, e isso não os mistura", () => {
    // Os dois chamam de "physics". O que separa é o providerId, não o nome
    // da matéria — foi por confiar no nome que o domínio vazou antes.
    expect(areasOf("ime").map((a) => a.id)).toContain("physics");
    expect(areasOf("ita").map((a) => a.id)).toContain("physics");
    expect(sameProvider("ime", "ita")).toBe(false);
  });

  it("o rótulo da matéria sai da taxonomia do IME", () => {
    expect(areaLabel("mathematics", "ime")).toBe("Matemática");
    expect(areaLabel("chemistry", "ime")).toBe("Química");
  });

  it("o IME não declara redação nem idioma", () => {
    expect(imeMetadata.hasEssay).toBe(false);
    expect(imeMetadata.languages).toEqual([]);
  });

  it("só a objetiva é executável nesta versão", () => {
    // A discursiva existe no arquivo e está declarada na fonte, mas não é
    // executável: não há correção de discursiva, e inventar uma seria pior
    // que não ter.
    expect(imeMetadata.phases).toEqual(["first"]);
    expect(imeSource.phases).toContain("second");
  });
});

describe("fonte e procedência", () => {
  it("está registrada e ligada ao provider", () => {
    expect(listSources().map((s) => s.id)).toContain("ime-cfg-archive");
    expect(imeSource.providerId).toBe(IME_PROVIDER_ID);
    expect(getProvider("ime").metadata.shortLabel).toBe("IME");
  });

  it("declara modo referência e direitos de referência oficial", () => {
    expect(imeSource.statementMode).toBe("reference-only");
    expect(imeSource.rightsStatus).toBe("official-reference");
    expect(imeSource.family).toBe("engineering");
  });

  it("declara descoberta automática, porque a página é que lista as edições", () => {
    // Os nomes de arquivo variam entre anos — inclusive com typo da própria
    // fonte. Inferir URL levaria a 404 ou ao documento errado.
    expect(imeSource.discovery).toBe("automatic");
  });

  it("não promete resolução de discursiva que o IME não publica assim", () => {
    expect(imeSource.answerKeyAvailable).toBe(true);
    expect(imeSource.expectedAnswersAvailable).toBe(false);
  });

  it("o importador responde procedência apontando o documento certo", () => {
    const imp = importerForProvider("ime")!;
    expect(imp.sourceId).toBe("ime-cfg-archive");
    const p = imp.provenanceFor(2026);
    expect(p.institution).toBe("IME");
    expect(p.documentUrl).toContain("Prova1fase2025OBJETIVA.pdf");
  });

  it("ano desconhecido aponta o arquivo da instituição, não uma URL montada", () => {
    const p = importerForProvider("ime")!.provenanceFor(1999);
    expect(p.documentUrl).toBe(imeSource.archiveUrl);
  });

  it("os anos do importador batem com os do catálogo", () => {
    expect(importerForProvider("ime")!.availableYears()).toEqual(imeYears());
  });
});

describe("edição por ano", () => {
  it("traduz ano de ingresso em edição", () => {
    expect(imeEditionOfYear(2026)).toBe("2025-2026");
    expect(imeEditionOfYear(2019)).toBe("2018-2019");
  });

  it("ano sem edição devolve null em vez de chutar a mais próxima", () => {
    expect(imeEditionOfYear(2017)).toBeNull();
  });

  it("o provider entrega as questões pelo ano", async () => {
    const p = listProviders().find((x) => x.id === "ime")!;
    const qs = await p.fetchQuestions({ year: 2026 });
    expect(qs).toHaveLength(40);
    expect(qs[0].providerId).toBe("ime");
  });

  it("a URL da prova existe em toda edição ingerida", () => {
    for (const ed of imeEditions()) {
      expect(imeExamUrl(ed), ed).toBeTruthy();
    }
  });
});
