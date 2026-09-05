import { describe, expect, it } from "vitest";
import { normalizeText, repairQuestionText, richText } from "./format";

describe("repairQuestionText", () => {
  it("repairs common UTF-8 mojibake without touching normal Portuguese", () => {
    expect(repairQuestionText("QuestÃ£o de MatemÃ¡tica e funÃ§Ã£o")).toBe(
      "Questão de Matemática e função",
    );
    expect(repairQuestionText("Questão de Matemática e função")).toBe(
      "Questão de Matemática e função",
    );
  });

  it("decodes common entities used in scientific questions", () => {
    expect(repairQuestionText("20&nbsp;&deg;C &plusmn; 2 &micro;m")).toBe("20 °C ± 2 µm");
    expect(repairQuestionText("x &le; 3 &amp; y &ge; 1")).toBe("x ≤ 3 & y ≥ 1");
  });

  it("keeps normalization useful for classifiers", () => {
    expect(normalizeText("Eletricidade: tensão e resistência")).toContain("tensao");
    expect(normalizeText("MatemÃ¡tica")).toBe("matematica");
  });
});

describe("richText", () => {
  it("preserves TeX delimiters for MathJax", () => {
    const html = richText("A expressão é \\(x^2 + \\frac{1}{2}\\) e vale 3.");
    expect(html).toContain("\\(x^2 + \\frac{1}{2}\\)");
    expect(html).toContain('class="mathSource"');
  });

  it("preserves safe sup/sub markup", () => {
    expect(richText("H<sub>2</sub>O e m<sup>2</sup>")).toContain("<sub>2</sub>");
    expect(richText("H<sub>2</sub>O e m<sup>2</sup>")).toContain("<sup>2</sup>");
  });

  it("turns markdown figures into zoomable question media", () => {
    const html = richText("![gráfico](https://example.com/grafico.png)");
    expect(html).toContain('data-zoomable="true"');
    expect(html).toContain('class="questionMedia"');
  });

  it("turns markdown tables into a scrollable question table", () => {
    const html = richText(
      "| Grandeza | Valor | Unidade |\n| --- | --- | --- |\n| Tensão | 220 | V |\n| Corrente | 10 | A |",
    );
    expect(html).toContain('class="questionTableWrap"');
    expect(html).toContain('class="questionTable"');
    expect(html).toContain("<th>Grandeza</th>");
    expect(html).toContain("<td>Corrente</td>");
  });
});