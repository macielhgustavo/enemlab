import { describe, expect, it } from "vitest";
import { CatalogIndex, type CatalogEntry } from "./index";
import {
  buildQuestionKey,
  parseQuestionKeyNumber,
  parseQuestionKeyProvider,
  sameQuestion,
} from "./question-key";

function ent(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    providerId: "ita",
    editionId: "2026",
    year: 2026,
    phase: "first",
    questionCount: 48,
    subjects: { mathematics: 12, physics: 12, chemistry: 12, english: 12 },
    validation: "verified",
    sourceId: "ita-official-archive",
    statementAvailable: false,
    importerVersion: "ita@1.0.0",
    ...over,
  };
}

const FAMILIAS = { ita: "engineering", ime: "engineering", enem: "general" } as const;

describe("índice do catálogo", () => {
  const idx = new CatalogIndex(
    [
      ent(),
      ent({ editionId: "2025", year: 2025 }),
      ent({ providerId: "enem", editionId: "2023", year: 2023, phase: "day1", questionCount: 90, subjects: { matematica: 45, linguagens: 45 }, statementAvailable: true, sourceId: "enem-dev", importerVersion: "enem@1.0.0" }),
      ent({ providerId: "ime", editionId: "2025-2026", year: 2026, phase: "objective", questionCount: 40, subjects: { mathematics: 10 }, validation: "provisional", sourceId: "ime-official", importerVersion: "ime@0.1.0" }),
      ent({ providerId: "ime", editionId: "2024-2025", year: 2025, phase: "objective", questionCount: 40, subjects: { mathematics: 10 }, validation: "blocked", sourceId: "ime-official", importerVersion: "ime@0.1.0" }),
    ],
    FAMILIAS,
  );

  it("por padrão só entrega o que foi conferido", () => {
    // §6: o banco padrão usa verified e reviewed. Quem quiser material não
    // conferido precisa pedir por escrito.
    const r = idx.query();
    expect(r.every((e) => e.validation === "verified")).toBe(true);
    expect(r.map((e) => e.editionId)).not.toContain("2025-2026");
  });

  it("entrega provisórias quando alguém pede explicitamente", () => {
    const r = idx.query({ validation: ["provisional"] });
    expect(r.map((e) => e.editionId)).toEqual(["2025-2026"]);
  });

  it("filtra por prova, ano e matéria sem carregar questão nenhuma", () => {
    expect(idx.query({ providerId: "ita" })).toHaveLength(2);
    expect(idx.query({ providerId: "ita", year: 2026 })).toHaveLength(1);
    expect(idx.query({ subject: "physics" })).toHaveLength(2);
  });

  it("filtra por família", () => {
    // Família é agrupamento de interface. Ela seleciona o que aparece, e
    // nada mais — não some estatística de provas diferentes.
    const eng = idx.query({ family: "engineering" });
    expect(eng.every((e) => e.providerId === "ita")).toBe(true);
  });

  it("filtra por modo referência", () => {
    expect(idx.query({ statementAvailable: true }).map((e) => e.providerId)).toEqual(["enem"]);
  });

  it("conta questões sem tocar no conteúdo", () => {
    expect(idx.countQuestions({ providerId: "ita" })).toEqual({ known: 96, unknownEditions: 0 });
    expect(idx.countQuestions({ providerId: "enem" })).toEqual({ known: 90, unknownEditions: 0 });
  });

  it("contagem desconhecida é reportada, não somada como zero", () => {
    // "96 questões" e "96 questões mais duas edições que não sabemos medir"
    // são frases diferentes, e o Data Quality precisa dizer a segunda.
    const comIncognita = new CatalogIndex(
      [ent(), ent({ editionId: "2024", year: 2024, questionCount: null, subjects: {} })],
      FAMILIAS,
    );
    expect(comIncognita.countQuestions({ providerId: "ita" })).toEqual({
      known: 48,
      unknownEditions: 1,
    });
    expect(comIncognita.summary()[0].unknownCount).toBe(1);
  });

  it("lista anos do mais recente ao mais antigo", () => {
    expect(idx.yearsOf("ita")).toEqual([2026, 2025]);
  });

  it("soma matérias entre edições", () => {
    expect(idx.subjectsOf("ita")).toEqual({
      mathematics: 24,
      physics: 24,
      chemistry: 24,
      english: 24,
    });
  });

  it("o resumo não conta questão de edição bloqueada", () => {
    // Edição bloqueada não é usável em lugar nenhum; contá-la infla o
    // tamanho aparente do banco e engana quem lê o Data Quality.
    const ime = idx.summary().find((s) => s.providerId === "ime")!;
    expect(ime.editions).toBe(2);
    expect(ime.blocked).toBe(1);
    expect(ime.questions).toBe(40);
  });

  it("o resumo separa questões em modo referência", () => {
    const ita = idx.summary().find((s) => s.providerId === "ita")!;
    expect(ita.referenceOnly).toBe(96);
    const enem = idx.summary().find((s) => s.providerId === "enem")!;
    expect(enem.referenceOnly).toBe(0);
  });

  it("é leve o bastante para viver no cliente", () => {
    // O motivo de o índice existir: uma linha por edição, não por questão.
    // Se este número crescer para megabytes, a decisão de paginar passa a
    // ter base em medição, não em pressentimento.
    expect(idx.estimateSizeBytes()).toBeLessThan(4000);
    expect(idx.size).toBe(5);
  });
});

describe("chave de questão", () => {
  it("monta a chave no formato do escopo", () => {
    expect(
      buildQuestionKey({ providerId: "ime", editionId: "2025-2026", phase: "objective", number: 17 }),
    ).toBe("ime-2025-2026-objective-17");
  });

  it("inclui a variante quando a prova tem versões", () => {
    expect(
      buildQuestionKey({ providerId: "fuvest", editionId: "2026", phase: "first", variant: "v1", number: 34 }),
    ).toBe("fuvest-2026-first-v1-34");
  });

  it("prova sem variante não ganha uma inventada", () => {
    // Colocar "v1" onde não há versão criaria chave diferente para a mesma
    // questão a cada mudança de modelagem, e o aluno perderia o histórico.
    const k = buildQuestionKey({ providerId: "ita", editionId: "2026", phase: "first", number: 3 });
    expect(k).toBe("ita-2026-first-3");
    expect(k).not.toContain("v1");
  });

  it("é determinística: a mesma questão dá sempre a mesma chave", () => {
    const id = { providerId: "ita", editionId: "2026", phase: "first", number: 3 };
    expect(buildQuestionKey(id)).toBe(buildQuestionKey({ ...id }));
  });

  it("não usa o enunciado como identidade", () => {
    // §7. Um enunciado reextraído com um espaço a mais viraria outra
    // questão, e o histórico do aluno se perderia na reimportação.
    const a = buildQuestionKey({ providerId: "ita", editionId: "2026", phase: "first", number: 3 });
    expect(a).not.toMatch(/[A-Z]/);
    expect(a.length).toBeLessThan(40);
  });

  it("normaliza acento e caixa", () => {
    expect(
      buildQuestionKey({ providerId: "IME", editionId: "2026", phase: "Português", number: 1 }),
    ).toBe("ime-2026-portugues-1");
  });

  it("recusa número inválido em vez de gerar chave torta", () => {
    expect(() =>
      buildQuestionKey({ providerId: "ita", editionId: "2026", phase: "first", number: 0 }),
    ).toThrow(/número/i);
    expect(() =>
      buildQuestionKey({ providerId: "ita", editionId: "2026", phase: "first", number: 1.5 }),
    ).toThrow();
  });

  it("recusa parte que não sobrevive à normalização", () => {
    expect(() =>
      buildQuestionKey({ providerId: "!!!", editionId: "2026", phase: "first", number: 1 }),
    ).toThrow(/inválida/i);
  });

  it("chaves de provas diferentes nunca colidem", () => {
    const ita = buildQuestionKey({ providerId: "ita", editionId: "2026", phase: "first", number: 3 });
    const ime = buildQuestionKey({ providerId: "ime", editionId: "2026", phase: "first", number: 3 });
    expect(ita).not.toBe(ime);
  });

  it("dá para recuperar prova e número", () => {
    const k = buildQuestionKey({ providerId: "ime", editionId: "2025-2026", phase: "objective", number: 17 });
    expect(parseQuestionKeyProvider(k)).toBe("ime");
    expect(parseQuestionKeyNumber(k)).toBe(17);
  });

  it("identificador oficial decide quando existe", () => {
    // Versões que são só reordenação: a mesma questão com números
    // diferentes em cada caderno.
    const a = { providerId: "fuvest", editionId: "2026", phase: "first", variant: "v1", number: 10, officialId: "Q-882" };
    const b = { providerId: "fuvest", editionId: "2026", phase: "first", variant: "v2", number: 41, officialId: "Q-882" };
    expect(sameQuestion(a, b)).toBe(true);
  });

  it("sem identificador oficial, variantes diferentes são questões diferentes", () => {
    // É a resposta honesta: sem id da banca não dá para afirmar que são a
    // mesma sem comparar conteúdo — e conteúdo não é identidade.
    const a = { providerId: "fuvest", editionId: "2026", phase: "first", variant: "v1", number: 10 };
    const b = { providerId: "fuvest", editionId: "2026", phase: "first", variant: "v2", number: 41 };
    expect(sameQuestion(a, b)).toBe(false);
  });
});
