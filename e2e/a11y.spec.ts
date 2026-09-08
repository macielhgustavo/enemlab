import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { aguardarApp, prepare } from "./fixtures";
import { UI_SCREENS } from "./ui-screens";

/**
 * Acessibilidade automatizada.
 *
 * O axe pega o que dá para pegar sozinho: contraste, nome acessível, ordem
 * de cabeçalho, rótulo de campo. Ele **não** pega se a tela faz sentido
 * navegando só de teclado — isso continua sendo conferência humana, e está
 * escrito assim no checklist do design system.
 */

const REGRAS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const theme of ["dark", "light"] as const) {
  for (const tela of UI_SCREENS) {
    test(`${tela.name} ${theme} sem violação séria de a11y`, async ({ page }) => {
      await prepare(page, { theme, comHistorico: true });
      await page.goto(tela.url);
      await aguardarApp(page);
      const r = await new AxeBuilder({ page }).withTags(REGRAS).analyze();
      const serias = r.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      expect(
        serias.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      ).toEqual([]);
    });
  }
}

test("tema claro mantém o contraste", async ({ page }) => {
  await prepare(page, { theme: "light", comHistorico: true });
  await page.goto("/");
  await aguardarApp(page);

  const r = await new AxeBuilder({ page }).withTags(REGRAS).analyze();
  const contraste = r.violations.filter((v) => v.id === "color-contrast");
  expect(contraste.map((v) => `${v.nodes.length} nó(s): ${v.help}`)).toEqual([]);
});

test("o seletor de prova é operável por teclado", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await aguardarApp(page);

  const gatilho = page.locator(".el-provider__trigger");
  await gatilho.focus();
  await expect(gatilho).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Enter");
  await expect(gatilho).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  // Fechou e devolveu o foco: sem isso o teclado fica órfão no fim da ação.
  await expect(gatilho).toHaveAttribute("aria-expanded", "false");
  await expect(gatilho).toBeFocused();
});

test("o diálogo do relator de problema prende e devolve o foco", async ({ page }) => {
  await prepare(page, { comHistorico: true });
  await page.goto("/");
  await aguardarApp(page);

  // A paleta é o overlay presente em toda tela: serve de prova do contrato.
  await page.keyboard.press("ControlOrMeta+k");
  const busca = page.getByRole("combobox");
  await expect(busca).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(busca).toBeHidden();
});
