import { describe, expect, it } from "vitest";
import { classifyQuestion, finalTagRules, isUnclassifiedContent } from "./classify";
import type { Question } from "./types";

function q(context: string, discipline: string, extra: Partial<Question> = {}): Question {
  return {
    year: 2023,
    index: 1,
    discipline,
    context,
    alternativesIntroduction: "Assinale a alternativa correta.",
    alternatives: [
      { letter: "A", text: "1" },
      { letter: "B", text: "2" },
      { letter: "C", text: "3" },
      { letter: "D", text: "4" },
      { letter: "E", text: "5" },
    ],
    correctAlternative: "A",
    ...extra,
  };
}

describe("classifyQuestion v7.2", () => {
  it("detects compound interest with a detailed subtopic and high confidence", () => {
    const result = classifyQuestion(
      q(
        "Um capital aplicado a juros compostos gera um montante após 12 meses. Determine a taxa percentual.",
        "matematica",
      ),
    );
    expect(result.primary).toBe("Porcentagem e juros");
    expect(result.subtopic).toBe("Juros compostos");
    expect(result.confidence).toBe("alta");
    expect(result.path).toContain("Juros compostos");
  });

  it("classifies separation of mixtures instead of forcing stoichiometry", () => {
    const result = classifyQuestion(
      q(
        "Uma mistura heterogênea deve ser submetida a filtração e depois destilação para separar seus componentes.",
        "ciencias-natureza",
      ),
    );
    expect(result.primary).toBe("Química • Reações e separação");
    expect(result.subtopic).toBe("Separação de misturas");
    expect(result.confidence).toBe("alta");
  });

  it("distinguishes immunology from generic physiology", () => {
    const result = classifyQuestion(
      q(
        "A vacina estimula linfócitos e a produção de anticorpos contra um antígeno específico.",
        "ciencias-natureza",
      ),
    );
    expect(result.primary).toBe("Biologia • Imunologia");
    expect(result.subtopic).toBe("Vacinas e soros");
  });

  it("uses structural language metadata as strong evidence", () => {
    const result = classifyQuestion(
      q("Read the following advertisement and answer the question.", "linguagens", { language: "ingles" }),
    );
    expect(result.primary).toBe("Língua estrangeira");
    expect(result.confidence).toBe("alta");
  });

  it("keeps multiple useful tags when evidence overlaps", () => {
    const question = q(
      "O gráfico mostra a variação percentual do preço após um desconto de 20%. Analise a tabela.",
      "matematica",
    );
    const tags = finalTagRules(question);
    expect(tags).toContain("Porcentagem e juros");
    expect(tags).toContain("Leitura de gráficos");
  });

  it("admits low confidence instead of pretending a precise math topic", () => {
    const result = classifyQuestion(q("Uma situação cotidiana é apresentada aos estudantes.", "matematica"));
    expect(result.confidence).toBe("baixa");
    expect(isUnclassifiedContent(result.primary)).toBe(true);
  });
});
