import { expect, test } from "@playwright/test";
import { aguardarApp, prepare } from "./fixtures";

/**
 * Regressão visual.
 *
 * O que estes testes pegam: layout que quebrou, cor que mudou sem querer,
 * componente que sumiu. O que eles NÃO pegam: se a tela ficou bonita. Um
 * verde aqui só diz "nada mudou desde a última vez que alguém olhou".
 *
 * Por isso os snapshots são commitados: eles só valem enquanto alguém tiver
 * olhado a captura anterior e aprovado. Rodar `test:e2e:update` sem olhar o
 * diff transforma isto em decoração.
 *
 * A tolerância vive em playwright.config.ts (1,2% dos pixels) porque fonte e
 * antialiasing diferem entre Windows e o runner do CI.
 */

/** Congela o que muda sozinho, senão o diff acusa o relógio. */
async function estabilizar(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
      }
      /* A saudação e a data mudam com a hora do dia. */
      .dash-hero .sub, .pagehead .sub { visibility: hidden !important; }
    `,
  });
  await page.waitForTimeout(300);
}

test.describe("capturas de referência", () => {
  test("home escuro", async ({ page }) => {
    await prepare(page, { theme: "dark", comHistorico: true });
    await page.goto("/");
    await aguardarApp(page);
    await estabilizar(page);
    await expect(page).toHaveScreenshot("home-dark.png", { fullPage: true });
  });

  test("home claro", async ({ page }) => {
    await prepare(page, { theme: "light", comHistorico: true });
    await page.goto("/");
    await aguardarApp(page);
    await estabilizar(page);
    await expect(page).toHaveScreenshot("home-light.png", { fullPage: true });
  });

  test("plano escuro", async ({ page }) => {
    await prepare(page, { theme: "dark", comHistorico: true });
    await page.goto("/plano");
    await aguardarApp(page);
    await estabilizar(page);
    await expect(page).toHaveScreenshot("plano-dark.png", { fullPage: true });
  });

  test("seletor de prova aberto", async ({ page }) => {
    await prepare(page, { theme: "dark" });
    await page.goto("/");
    await aguardarApp(page);
    await estabilizar(page);

    await page.locator(".el-provider__trigger").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menu")).toHaveScreenshot("provider-switcher.png");
  });

  test("paleta de comandos", async ({ page }) => {
    await prepare(page, { theme: "dark" });
    await page.goto("/");
    await aguardarApp(page);
    await estabilizar(page);

    await page.keyboard.press("ControlOrMeta+k");
    const painel = page.locator(".cmdk");
    await expect(painel).toBeVisible();
    await expect(painel).toHaveScreenshot("command-palette.png");
  });
});
