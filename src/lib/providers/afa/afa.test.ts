import { describe, expect, it } from "vitest";
import { afaAnswerKey, afaFirstPhaseQuestions, afaProvider, afaVariants, afaYears } from ".";
import { variantsForReference, variantsToIngest } from "../../catalog/variant";
import { compareVariantKeys } from "../../catalog/variant";
import { afaSource } from "@/lib/sources";

/**
 * Estes testes existem por causa de um defeito específico: a primeira versão
 * deste provider foi escrita sem que nenhum documento fosse lido, e a
 * checagem que a acompanhava comparava as questões geradas com o gabarito de
 * onde elas saíam — os dois lados do mesmo campo, então nada podia falhar.
 *
 * O que passou por baixo dessa checagem circular:
 *
 *   - AFA 2023 perdeu a anulação da questão 33, e as questões 31 a 64 vieram
 *     do gabarito da **versão C** enquanto as anteriores vieram da A. Metade
 *     da prova seria corrigida pelo caderno errado.
 *   - 2021, 2022 e 2023 receberam ordem de matérias de outro ano. Quem
 *     filtrasse "Matemática" estudaria Física.
 *
 * Por isso o que se testa aqui não é "o gabarito bate com ele mesmo", e sim
 * fatos conferidos contra o PDF oficial e relações que dado inventado não
 * costuma satisfazer.
 */

describe("catálogo ingerido", () => {
  it("traz as oito edições lidas de documento", () => {
    // 2026 não está aqui de propósito: a FAB aplicou a prova, mas nenhuma
    // cópia legível do gabarito final é acessível. A versão anterior deste
    // provider a declarava mesmo assim.
    expect(afaYears()).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]);
  });

  it("cada edição registra de onde os bytes foram lidos", () => {
    // `answerKeyUrl` é a URL oficial — o que o aluno cita. `retrieval` é de
    // onde a ingestão leu. Confundir os dois era a afirmação sem lastro.
    for (const year of afaYears()) {
      const key = afaAnswerKey(year)!;
      expect(key.answerKeyUrl, String(year)).toMatch(/^https:\/\/www\.fab\.mil\.br\//);
      expect(key.retrieval.route, String(year)).toBe("web-archive");
      expect(key.retrieval.sha256, String(year)).toMatch(/^[0-9a-f]{64}$/);
      expect(key.retrieval.bytes, String(year)).toBeGreaterThan(10_000);
      expect(key.retrieval.retrievedFrom, String(year)).toContain(key.answerKeyUrl);
    }
  });

  it("todo gabarito ingerido é o final, nunca o preliminar", () => {
    for (const year of afaYears()) {
      expect(afaAnswerKey(year)!.revision, String(year)).toBe("final");
    }
  });

  it("as anuladas conferidas no PDF estão registradas", () => {
    // Conferidas à mão nos documentos oficiais. A de 2023 é a que a versão
    // anterior perdia — ela dava "B" para uma questão anulada, letra que na
    // verdade é a das versões B e C.
    expect(afaAnswerKey(2023)!.annulled).toEqual([33]);
    expect(afaAnswerKey(2024)!.annulled).toEqual([60, 62]);
    expect(afaAnswerKey(2025)!.annulled).toEqual([11, 32, 41, 51]);
    expect(afaAnswerKey(2022)!.annulled).toEqual([21]);
  });

  it("questão anulada chega sem gabarito, para não contar como erro", () => {
    const q33 = afaFirstPhaseQuestions(2023).find((q) => q.number === 33)!;
    expect(q33.correctAlternative).toBeNull();
    expect(q33.alternatives.some((a) => a.isCorrect)).toBe(false);
  });
});

describe("matérias", () => {
  it("a ordem sai do documento, e ela muda de ano", () => {
    // Este é o fato que a versão anterior não modelava. O cabeçalho de 2022
    // diz "LÍNGUA INGLESA - FÍSICA - LÍNGUA PORTUGUESA E MATEMÁTICA"; o de
    // 2024 diz o contrário. Assumir uma ordem fixa rotula Física como
    // Matemática na metade das edições.
    const primeira = (year: number) => afaFirstPhaseQuestions(year)[0].subject.id;
    expect(primeira(2021)).toBe("english");
    expect(primeira(2022)).toBe("english");
    expect(primeira(2023)).toBe("english");
    expect(primeira(2024)).toBe("portuguese");
    expect(primeira(2019)).toBe("portuguese");
  });

  it("2022 põe Física no bloco que 2024 dá a Matemática", () => {
    // Escrito como comparação porque é exatamente a troca que acontecia.
    const materia = (year: number, number: number) =>
      afaFirstPhaseQuestions(year).find((q) => q.number === number)!.subject.id;
    expect(materia(2022, 20)).toBe("physics");
    expect(materia(2024, 20)).toBe("mathematics");
  });

  it("declara que a divisão é derivada, não transcrita", () => {
    // O gabarito da FAB lista a ordem das matérias mas não onde cada bloco
    // começa. Os blocos iguais são inferência, e o campo diz isso.
    for (const year of afaYears()) {
      expect(afaAnswerKey(year)!.subjectsDerivedFrom, String(year)).toBe("answer-key-header");
    }
  });

  it("as edições com caderno acessível tiveram a divisão confirmada", () => {
    // Nestas três o importador leu o caderno de prova e conferiu onde cada
    // seção começa. Nas outras o caderno arquivado está truncado, e a
    // ingestão registra `false` em vez de fingir conferência.
    for (const year of [2023, 2024, 2025]) {
      expect(afaAnswerKey(year)!.subjectBoundariesVerified, String(year)).toBe(true);
    }
    for (const year of [2018, 2019, 2020, 2021, 2022]) {
      expect(afaAnswerKey(year)!.subjectBoundariesVerified, String(year)).toBe(false);
    }
  });

  it("as matérias cobrem 1..64 sem buraco nem sobreposição", () => {
    for (const year of afaYears()) {
      const vistas = new Set<number>();
      for (const q of afaFirstPhaseQuestions(year)) {
        expect(q.subject.id, `${year} q${q.number}`).not.toBe("unknown");
        expect(vistas.has(q.number!), `${year} q${q.number}`).toBe(false);
        vistas.add(q.number!);
      }
      expect(vistas.size, String(year)).toBe(64);
    }
  });
});

describe("versões", () => {
  it("as três versões foram lidas, e discordam entre si", () => {
    // Numa prova reordenada os gabaritos **precisam** divergir. Duas colunas
    // iguais denunciariam parser que leu o mesmo bloco duas vezes — e é a
    // deriva entre colunas que estragou 2023 antes.
    for (const year of afaYears()) {
      const key = afaAnswerKey(year)!;
      expect(Object.keys(key.variantAnswers).sort(), String(year)).toEqual(["a", "b", "c"]);

      const numeros = (v: string) =>
        Object.fromEntries(
          Object.entries(key.variantAnswers[v]).map(([n, letra]) => [Number(n), letra]),
        );
      const { mismatches, suspiciouslyIdentical } = compareVariantKeys(
        { variant: "a", answers: numeros("a") },
        { variant: "c", answers: numeros("c") },
      );
      expect(suspiciouslyIdentical, String(year)).toBe(false);
      expect(mismatches.length, String(year)).toBeGreaterThan(20);
    }
  });

  it("só a canônica vira questão", () => {
    const variants = afaVariants(2025)!;
    expect(variants.relation).toBe("reordered");
    expect(variantsToIngest(variants).map((v) => v.id)).toEqual(["a"]);
    expect(variantsForReference(variants).map((v) => v.id)).toEqual(["b", "c"]);
  });

  it("a questão sai da versão canônica, não de outra coluna", () => {
    // 2023 é o caso concreto: da questão 31 em diante a versão anterior
    // trazia as letras da versão C.
    const key = afaAnswerKey(2023)!;
    for (const q of afaFirstPhaseQuestions(2023)) {
      const naCanonica = key.variantAnswers.a[String(q.number)];
      if (naCanonica === "X") {
        expect(q.correctAlternative, `q${q.number}`).toBeNull();
      } else {
        expect(q.correctAlternative, `q${q.number}`).toBe(naCanonica);
      }
    }
  });
});

describe("forma das questões", () => {
  it("monta as 64 questões de cada edição, numeradas de 1 a 64", () => {
    for (const year of afaYears()) {
      const qs = afaFirstPhaseQuestions(year);
      expect(qs, String(year)).toHaveLength(64);
      expect(qs.map((q) => q.number)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
      expect(qs.every((q) => q.alternatives.map((a) => a.letter).join("") === "ABCD")).toBe(true);
    }
  });

  it("não reproduz enunciado", () => {
    for (const q of afaFirstPhaseQuestions(2024)) {
      expect(q.statementAvailable).toBe(false);
      expect(q.context).toBeNull();
      expect(q.alternatives.every((a) => a.text === null)).toBe(true);
    }
  });

  it("a chave não colide com as outras provas", () => {
    expect(afaProvider.questionKey(afaFirstPhaseQuestions(2025)[0])).toBe("afa-2025-first-1");
  });

  it("edição inexistente devolve lista vazia, não erro nem invenção", () => {
    expect(afaFirstPhaseQuestions(2026)).toEqual([]);
    expect(afaAnswerKey(2026)).toBeNull();
  });
});

describe("fonte", () => {
  it("declara que a leitura passa pelo arquivo público", () => {
    // A FAB responde 403 a cliente automatizado. Declarar `live` faria o
    // audit reportar quebra a cada rodada, e esconderia de onde os dados vêm.
    expect(afaSource.retrievalRoute).toBe("web-archive");
    expect(afaSource.discovery).toBe("automatic");
  });

  it("os anos da fonte são os que a ingestão validou", () => {
    expect([...afaSource.years].sort((a, b) => b - a)).toEqual(afaYears());
  });
});
