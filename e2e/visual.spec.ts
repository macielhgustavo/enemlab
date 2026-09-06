import { expect, test } from "@playwright/test";
import { INSTANTE_FIXO, aguardarApp, prepararCaptura, prepare } from "./fixtures";

/**
 * Regressão visual.
 *
 * O que estes testes pegam: layout que quebrou, cor que mudou sem querer,
 * componente que sumiu. O que eles NÃO pegam: se a tela ficou bonita. Um
 * verde aqui só diz "nada mudou desde a última vez que alguém olhou".
 *
 * As capturas de referência são geradas no Linux, pelo mesmo runner que roda
 * o CI (veja docs/visual-testing.md). Copiar PNG do Windows para servir de
 * referência no Linux não funciona: fonte e antialiasing diferem o bastante
 * para reprovar tudo.
 *
 * Determinismo, em ordem de importância:
 *   1. relógio congelado — a Home mostra data e saudação por hora do dia;
 *   2. dados de fixture — nada vem da rede;
 *   3. animação desligada e fonte carregada antes de medir;
 *   4. barra de rolagem escondida — largura difere entre sistemas.
 */

test.describe("capturas de referência", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(INSTANTE_FIXO);
  });

  /**
   * Tolerância por tela.
   *
   * A tolerância global de 1,2% existe para sobreviver a sub-pixel entre
   * máquinas, mas ela é uma fração do total: numa página longa, 1,2% dos
   * pixels é muito espaço para uma mudança real se esconder — a correção de
   * espaçamento no Resultado, por exemplo, não fez a captura falhar.
   *
   * Telas curtas e densas em texto usam uma régua mais apertada; telas
   * longas mantêm a folga, porque nelas o ruído acumula mais.
   */
  const cenarios: {
    nome: string;
    arquivo: string;
    url: string;
    tema: "dark" | "light";
    tolerancia?: number;
  }[] = [
    { nome: "home escuro", arquivo: "home-dark.png", url: "/", tema: "dark" },
    { nome: "home claro", arquivo: "home-light.png", url: "/", tema: "light" },
    // O Banco é uma lista repetitiva: mudança de layout aparece em todas as
    // linhas de uma vez, então dá para exigir mais.
    { nome: "banco escuro", arquivo: "bank-dark.png", url: "/bank", tema: "dark", tolerancia: 0.005 },
    { nome: "banco claro", arquivo: "bank-light.png", url: "/bank", tema: "light", tolerancia: 0.005 },
    { nome: "histórico", arquivo: "history-dark.png", url: "/history", tema: "dark", tolerancia: 0.006 },
    { nome: "resultado", arquivo: "result-dark.png", url: "/result/a_fixture_enem", tema: "dark" },
    { nome: "plano", arquivo: "plano-dark.png", url: "/plano", tema: "dark" },
    { nome: "revisões", arquivo: "srs-dark.png", url: "/srs", tema: "dark", tolerancia: 0.006 },
    { nome: "domínio", arquivo: "mastery-dark.png", url: "/mastery", tema: "dark", tolerancia: 0.006 },
  ];

  for (const c of cenarios) {
    test(c.nome, async ({ page }) => {
      await prepare(page, { theme: c.tema, comHistorico: true });
      await page.goto(c.url);
      await aguardarApp(page);
      await prepararCaptura(page);
      await expect(page).toHaveScreenshot(c.arquivo, {
        fullPage: true,
        ...(c.tolerancia ? { maxDiffPixelRatio: c.tolerancia } : {}),
      });
    });
  }

  test("seletor de prova aberto", async ({ page }) => {
    await prepare(page, { theme: "dark" });
    await page.goto("/");
    await aguardarApp(page);
    await prepararCaptura(page);

    await page.locator(".el-provider__trigger").click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveScreenshot("provider-switcher.png");
  });

  test("paleta de comandos", async ({ page }) => {
    await prepare(page, { theme: "dark" });
    await page.goto("/");
    await aguardarApp(page);
    await prepararCaptura(page);

    await page.keyboard.press("ControlOrMeta+k");
    const painel = page.locator(".cmdk");
    await expect(painel).toBeVisible();
    await expect(painel).toHaveScreenshot("command-palette.png");
  });
});
