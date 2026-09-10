import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AnimatedNumber, Ring } from "./dash";

// Estes componentes já mostraram número errado no browser: os indicadores da
// Home ficaram travados em zero e o anel de meta desenhou 0% enquanto o rótulo
// ao lado dizia 57%. A animação é enfeite; o valor é o produto. O que estes
// testes protegem é o valor, não a interpolação.
//
// Aviso honesto: o jsdom NÃO reproduz aquela falha — ela só aparecia no build
// do browser. Estes testes travam o contrato ("o valor mostrado é o valor
// recebido"), não o bug específico. Mudança nesses componentes ainda pede
// conferência no browser.

describe("AnimatedNumber", () => {
  it("chega ao valor real", async () => {
    render(<AnimatedNumber value={42} />);
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
  });

  it("não fica preso em zero quando o valor muda depois da montagem", async () => {
    const { rerender } = render(<AnimatedNumber value={0} />);
    rerender(<AnimatedNumber value={7} />);
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
  });

  // O painel chegou a ficar um passo atrás: ao trocar de prova, o ENEM exibia
  // a taxa do ITA. Trocar de valor tem que trocar o número no mesmo quadro.
  it("troca de valor sem passar pelo valor anterior", () => {
    const { rerender } = render(<AnimatedNumber value={67} />);
    rerender(<AnimatedNumber value={12} />);
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("67")).not.toBeInTheDocument();
  });

  it("respeita o formatador", async () => {
    render(<AnimatedNumber value={67} format={(n) => `${Math.round(n)}%`} />);
    await waitFor(() => expect(screen.getByText("67%")).toBeInTheDocument());
  });

  it("não quebra com valor não finito", async () => {
    render(<AnimatedNumber value={Number.NaN} />);
    await waitFor(() => expect(screen.getByText("0")).toBeInTheDocument());
  });
});

describe("Ring", () => {
  const arco = (c: Element) => {
    const circ = parseFloat(c.getAttribute("stroke-dasharray") ?? "0");
    const off = parseFloat(c.getAttribute("stroke-dashoffset") ?? "0");
    return Math.round((1 - off / circ) * 100);
  };

  const progresso = (container: HTMLElement) => {
    const circulos = container.querySelectorAll("circle");
    // O primeiro é o trilho; o segundo é o arco de progresso.
    return circulos[1];
  };

  it("desenha o arco proporcional ao valor", async () => {
    const { container } = render(<Ring value={57} />);
    await waitFor(() => expect(arco(progresso(container))).toBe(57));
  });

  it("desenha o anel cheio em 100%", async () => {
    const { container } = render(<Ring value={100} />);
    await waitFor(() => expect(arco(progresso(container))).toBe(100));
  });

  it("trata ausência de dado como anel vazio, não como erro", async () => {
    const { container } = render(<Ring value={null} />);
    await waitFor(() => expect(arco(progresso(container))).toBe(0));
  });

  it("limita valor fora da faixa em vez de estourar o arco", async () => {
    const { container } = render(<Ring value={180} />);
    await waitFor(() => expect(arco(progresso(container))).toBe(100));
  });

  it("troca de valor sem passar pelo valor anterior", () => {
    const { container, rerender } = render(<Ring value={57} />);
    rerender(<Ring value={0} />);
    expect(arco(progresso(container))).toBe(0);
  });
});

describe("sem animação nenhuma", () => {
  afterEach(() => vi.restoreAllMocks());

  // O modo de falha que nos custou caro foi a animação não rodar e a tela ficar
  // com o valor inicial. Com requestAnimationFrame morto, o valor certo ainda
  // precisa aparecer — perder a contagem é aceitável, mentir não é.
  const semQuadros = () => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 0);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  };

  it("o número mostra o valor real mesmo sem quadros", () => {
    semQuadros();
    render(<AnimatedNumber value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("o anel desenha o arco real mesmo sem quadros", () => {
    semQuadros();
    const { container } = render(<Ring value={57} />);
    const c = container.querySelectorAll("circle")[1];
    const circ = parseFloat(c.getAttribute("stroke-dasharray") ?? "0");
    const off = parseFloat(c.getAttribute("stroke-dashoffset") ?? "0");
    expect(Math.round((1 - off / circ) * 100)).toBe(57);
  });
});
