import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Cor literal fora dos tokens.
 *
 * Um `#0e1619` escrito dentro de um componente não existe no tema claro, não
 * responde a `prefers-contrast` e não aparece quando alguém procura onde uma
 * cor é definida. O token existe para ser o único lugar.
 *
 * Este teste é deliberadamente estreito: só varre a camada nova
 * (`components/ui`, `components/enem-lab`, `styles/components.css`,
 * `styles/enem-lab.css`). O CSS legado tem centenas de literais e travá-lo
 * agora só produziria uma lista vermelha que ninguém consegue zerar — a
 * migração dele é gradual e está registrada em docs/design-system.md.
 */

const RAIZ = join(__dirname, "..", "..");

const ALVOS = [
  "components/ui",
  "components/enem-lab",
  "styles/components.css",
  "styles/enem-lab.css",
  "styles/typography.css",
];

// `tokens.css` fica fora de propósito: é o único lugar onde um valor de cor
// literal é a resposta certa. Vigiá-lo seria proibir a definição do token.

/**
 * Fatia do CSS legado já sob a regra.
 *
 * O legado inteiro tem centenas de literais e travá-lo de uma vez produziria
 * uma lista que ninguém zera. Em vez disso, cada bloco migrado entra aqui e
 * não sai mais — o número abaixo só pode subir.
 *
 * Como funciona: as regras de `globals.css` cujo seletor menciona uma destas
 * classes passam a valer a mesma proibição do design system.
 */
const LEGADO_SOB_REGRA = ["rail", "railnav", "railgroup", "mobilebar", "cmdk"];

/**
 * Exceções, cada uma com motivo.
 *
 * Story e teste podem usar literal: são documentação e fixture, não produto.
 * O texto sobre o verde da marca precisa de um valor fixo porque a cor de
 * fundo é sempre o verde, nos dois temas — um token de texto que virasse
 * claro no tema claro deixaria o botão ilegível.
 */
const EXCECOES: { arquivo: RegExp; valor?: RegExp; motivo: string }[] = [
  { arquivo: /\.stories\.tsx$/, motivo: "story é documentação, não produto" },
  { arquivo: /\.test\.tsx?$/, motivo: "fixture de teste" },
  {
    arquivo: /styles[/\\]components\.css$/,
    valor: /#04120d/,
    motivo: "texto sobre o verde da marca: o fundo é o mesmo nos dois temas",
  },
];

/** Hex de 3, 4, 6 ou 8 dígitos, e as funções de cor com número literal. */
const PADRAO = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(\s*\d[^)]*\)/g;

function arquivos(caminho: string): string[] {
  const cheio = join(RAIZ, caminho);
  let st;
  try {
    st = statSync(cheio);
  } catch {
    return [];
  }
  if (st.isFile()) return [cheio];
  return readdirSync(cheio).flatMap((n) => arquivos(join(caminho, n)));
}

function permitido(rel: string, valor: string): boolean {
  return EXCECOES.some(
    (e) => e.arquivo.test(rel) && (!e.valor || e.valor.test(valor)),
  );
}

/**
 * Regras de globals.css cujo seletor menciona uma das classes vigiadas.
 *
 * Sem regex montado por string. Dentro de um template literal a sequência
 * barra-b vira o caractere backspace, e não a borda de palavra do regex:
 * a primeira versão disto virou /.(rail|...)/ com um backspace no fim e
 * não casava com nada, então o teste passava sem olhar uma linha sequer.
 * Comparação de texto simples não tem esse buraco.
 */
function mencionaClasseVigiada(seletor: string): boolean {
  return LEGADO_SOB_REGRA.some((classe) => {
    const i = seletor.indexOf("." + classe);
    if (i === -1) return false;
    // Borda à direita conferida na mão: `.rail` não pode casar `.railway`.
    const depois = seletor[i + classe.length + 1] ?? " ";
    return !/[a-zA-Z0-9_-]/.test(depois);
  });
}

function regrasLegadasVigiadas(): { linha: number; texto: string }[] {
  const css = readFileSync(join(RAIZ, "app", "globals.css"), "utf8").split("\n");

  const achados: { linha: number; texto: string }[] = [];
  let dentro = false;
  css.forEach((linha, i) => {
    if (!dentro && linha.includes("{") && mencionaClasseVigiada(linha)) dentro = true;
    else if (dentro) {
      if (linha.includes("}")) dentro = false;
      else achados.push({ linha: i + 1, texto: linha });
    }
  });
  return achados;
}

describe("cores literais", () => {
  it("a camada do design system usa só tokens", () => {
    const achados: string[] = [];

    for (const alvo of ALVOS) {
      for (const arquivo of arquivos(alvo)) {
        if (!/\.(tsx?|css)$/.test(arquivo)) continue;
        const rel = relative(RAIZ, arquivo).split(sep).join("/");
        const linhas = readFileSync(arquivo, "utf8").split("\n");

        linhas.forEach((linha, i) => {
          // `color-mix(... transparent)` sobre um token continua sendo token.
          for (const m of linha.match(PADRAO) ?? []) {
            if (permitido(rel, m)) continue;
            achados.push(`${rel}:${i + 1} → ${m}`);
          }
        });
      }
    }

    expect(achados).toEqual([]);
  });

  it("a fatia do legado já migrada também usa só tokens", () => {
    const achados = regrasLegadasVigiadas()
      .flatMap(({ linha, texto }) =>
        (texto.match(PADRAO) ?? []).map((m) => `globals.css:${linha} → ${m}`),
      );
    expect(achados).toEqual([]);
  });

  it("o scanner do legado enxerga regras de verdade", () => {
    // Guarda contra o modo de falha mais perigoso deste arquivo: passar
    // porque não encontrou nada. Já aconteceu — um `\b` dentro de template
    // literal virou backspace e o scanner varria zero linhas.
    expect(regrasLegadasVigiadas().length).toBeGreaterThan(40);
  });

  it("a fatia vigiada do legado só cresce", () => {
    // Tirar uma classe daqui é desfazer migração. Se este número cair,
    // alguém precisa explicar por quê.
    expect(LEGADO_SOB_REGRA.length).toBeGreaterThanOrEqual(5);
  });

  it("a lista de exceções não cresce em silêncio", () => {
    // Cada exceção custa uma explicação. Se este número subir, alguém
    // precisa ter escrito o motivo junto.
    expect(EXCECOES).toHaveLength(3);
    for (const e of EXCECOES) expect(e.motivo.length).toBeGreaterThan(10);
  });
});
