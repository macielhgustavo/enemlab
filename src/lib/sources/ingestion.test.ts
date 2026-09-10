import { describe, expect, it } from "vitest";
import {
  acceptEdition,
  compareFingerprints,
  formatImportReport,
  isBlocked,
  usableInDefaultBank,
  validateEdition,
  type DocumentFingerprint,
  type EditionUnderValidation,
  type RawImportedExam,
} from "./ingestion";

/**
 * A regra desta suíte é a do §41: **falhar fechado**.
 *
 * Cada teste abaixo descreve uma forma de a importação sair errada. O
 * comportamento certo em todas é o mesmo — recusar a edição. Uma prova com
 * 59 de 60 questões não é "quase certa": ela corrige errado, e corrigir
 * errado contamina histórico, SRS e mapa de domínio de uma vez.
 */

function edicao(over: Partial<EditionUnderValidation> = {}): EditionUnderValidation {
  const total = over.expectedCount ?? 10;
  const numeros = over.parsedNumbers ?? Array.from({ length: total }, (_, i) => i + 1);
  const gabarito =
    over.answerKey ?? Object.fromEntries(numeros.map((n) => [n, "A"] as const));
  return {
    providerId: "prova",
    sourceId: "fonte",
    editionId: "2026",
    importerVersion: "teste@1.0.0",
    parsedNumbers: numeros,
    expectedCount: total,
    answerKey: gabarito,
    annulled: [],
    allowedLetters: ["A", "B", "C", "D", "E"],
    subjects: { matematica: total },
    documentsDiscovered: 2,
    documentsFetched: 2,
    ...over,
  };
}

describe("validação de edição", () => {
  it("aprova como provisória quando tudo bate", () => {
    const r = validateEdition(edicao());
    expect(r.validation).toBe("provisional");
    expect(r.issues).toEqual([]);
    expect(r.objectiveParsed).toBe(10);
    expect(r.answerKeysMatched).toBe(10);
  });

  it("nunca se declara verificada sozinha", () => {
    // `verified` e `reviewed` exigem conferência humana (§6, §40): um
    // programa não pode se declarar conferido por outra pessoa.
    const r = validateEdition(edicao());
    expect(r.validation).not.toBe("verified");
    expect(r.validation).not.toBe("reviewed");
  });

  it("recusa quando falta uma questão", () => {
    const r = validateEdition(edicao({ expectedCount: 10, parsedNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9] }));
    expect(r.validation).toBe("blocked");
    expect(r.issues.map((i) => i.code)).toContain("count-mismatch");
    expect(r.issues.map((i) => i.code)).toContain("missing-number");
    expect(r.unmatched).toContain(10);
  });

  it("recusa numeração duplicada", () => {
    const r = validateEdition(
      edicao({ expectedCount: 3, parsedNumbers: [1, 2, 2], answerKey: { 1: "A", 2: "B", 3: "C" } }),
    );
    expect(r.validation).toBe("blocked");
    expect(r.duplicates).toEqual([2]);
  });

  it("recusa questão sem gabarito", () => {
    const r = validateEdition(edicao({ expectedCount: 3, parsedNumbers: [1, 2, 3], answerKey: { 1: "A", 2: "B" } }));
    expect(r.validation).toBe("blocked");
    expect(r.issues.map((i) => i.code)).toContain("answer-key-mismatch");
    expect(r.unmatched).toEqual([3]);
  });

  it("recusa letra fora do conjunto da prova", () => {
    const r = validateEdition(
      edicao({ expectedCount: 2, parsedNumbers: [1, 2], answerKey: { 1: "A", 2: "F" } }),
    );
    expect(r.validation).toBe("blocked");
    expect(r.issues.map((i) => i.code)).toContain("invalid-letter");
  });

  it("aceita anulada sem gabarito, e ela não conta como falta", () => {
    const r = validateEdition(
      edicao({ expectedCount: 3, parsedNumbers: [1, 2, 3], answerKey: { 1: "A", 3: "C" }, annulled: [2] }),
    );
    expect(r.validation).toBe("provisional");
    expect(r.annulled).toEqual([2]);
    expect(r.unmatched).toEqual([]);
  });

  it("recusa quando um documento não foi baixado", () => {
    const r = validateEdition(edicao({ documentsDiscovered: 3, documentsFetched: 2 }));
    expect(r.validation).toBe("blocked");
    expect(r.issues.map((i) => i.code)).toContain("document-missing");
  });

  it("recusa quando o documento mudou na origem", () => {
    // §8: retificação silenciosa não pode passar por importação normal.
    const r = validateEdition(edicao({ changedDocuments: ["gabarito.pdf"] }));
    expect(r.validation).toBe("blocked");
    expect(r.issues.map((i) => i.code)).toContain("document-changed");
  });

  it("gabarito só preliminar avisa mas não reprova", () => {
    // Edição recém-aplicada é caso legítimo — o que não pode é ser dada
    // como conferida.
    const r = validateEdition(edicao({ preliminaryKeyOnly: true }));
    expect(r.validation).toBe("provisional");
    const aviso = r.issues.find((i) => i.code === "preliminary-key-only");
    expect(aviso?.fatal).toBe(false);
  });

  it("mídia ausente é aviso, não bloqueio", () => {
    // §12: a questão existe e o gabarito está certo; o que falta é a
    // imagem. Quem decide se ela é utilizável é o Data Quality.
    const r = validateEdition(edicao({ questionsMissingMedia: [4] }));
    expect(r.validation).toBe("provisional");
    expect(r.issues.find((i) => i.code === "media-missing")?.fatal).toBe(false);
  });
});

describe("promoção a edição do catálogo", () => {
  function bruto(): RawImportedExam {
    return {
      providerId: "prova",
      sourceId: "fonte",
      editionId: "2026",
      year: 2026,
      phase: "objective",
      importerVersion: "teste@1.0.0",
      fingerprints: [],
      parsedNumbers: [1, 2, 3],
      answerKey: { 1: "A", 2: "B", 3: "C" },
      annulled: [],
      subjects: { matematica: 3 },
      statementMode: "reference-only",
      extractionMethod: "pdf-text-layer",
      rightsStatus: "official-reference",
    };
  }

  it("não existe caminho que publique edição reprovada", () => {
    const r = validateEdition(edicao({ expectedCount: 3, parsedNumbers: [1, 2] }));
    expect(isBlocked(r.validation)).toBe(true);
    expect(acceptEdition(bruto(), r)).toBeNull();
    // Nem com nível conferido informado: a reprovação não é negociável.
    expect(acceptEdition(bruto(), r, "verified")).toBeNull();
  });

  it("conferência humana eleva o nível", () => {
    const r = validateEdition(edicao({ expectedCount: 3, parsedNumbers: [1, 2, 3] }));
    const e = acceptEdition(bruto(), r, "verified");
    expect(e?.validation).toBe("verified");
    expect(e?.report.validation).toBe("verified");
  });

  it("gabarito preliminar não vira verificado nem com conferência", () => {
    // O aviso é sobre o dado, não sobre quem olhou: enquanto o final não
    // sair, a resposta pode mudar.
    const r = validateEdition(edicao({ expectedCount: 3, parsedNumbers: [1, 2, 3], preliminaryKeyOnly: true }));
    const e = acceptEdition(bruto(), r, "verified");
    expect(e?.validation).toBe("provisional");
  });
});

describe("banco padrão", () => {
  it("usa verificado e revisado, e nada abaixo disso", () => {
    expect(usableInDefaultBank("verified")).toBe(true);
    expect(usableInDefaultBank("reviewed")).toBe(true);
    expect(usableInDefaultBank("provisional")).toBe(false);
    expect(usableInDefaultBank("blocked")).toBe(false);
  });
});

describe("impressão digital de documento", () => {
  const fp = (over: Partial<DocumentFingerprint> = {}): DocumentFingerprint => ({
    url: "https://exemplo/gabarito.pdf",
    contentLength: 1000,
    sha256: "abc",
    parserVersion: "teste@1.0.0",
    importedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  it("hash igual é documento igual", () => {
    expect(compareFingerprints(fp(), fp())).toBe("identical");
  });

  it("hash diferente é documento alterado", () => {
    expect(compareFingerprints(fp(), fp({ sha256: "xyz" }))).toBe("changed");
  });

  it("sem leitura anterior, não afirma nada", () => {
    expect(compareFingerprints(undefined, fp())).toBe("unknown");
  });

  it("sem hash dos dois lados, tamanho igual não prova igualdade", () => {
    // Dois PDFs de mesmo tamanho podem ter conteúdo diferente. Dizer
    // "idêntico" aqui esconderia uma retificação.
    const a = fp({ sha256: "" });
    const b = fp({ sha256: "" });
    expect(compareFingerprints(a, b)).toBe("unknown");
  });
});

describe("relatório", () => {
  it("mostra os números que o escopo pede", () => {
    const r = validateEdition(
      edicao({ expectedCount: 4, parsedNumbers: [1, 2, 3, 4], answerKey: { 1: "A", 2: "B", 4: "D" }, annulled: [3] }),
    );
    const texto = formatImportReport(r);
    expect(texto).toContain("objetivas esperadas:    4");
    expect(texto).toContain("objetivas extraídas:    4");
    expect(texto).toContain("anuladas:   3");
    expect(texto).toContain("validação: PROVISIONAL");
  });

  it("lista os problemas fatais quando reprova", () => {
    const r = validateEdition(edicao({ expectedCount: 5, parsedNumbers: [1, 2, 3] }));
    const texto = formatImportReport(r);
    expect(texto).toContain("validação: BLOCKED");
    expect(texto).toContain("[FATAL]");
  });
});
