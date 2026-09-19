import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { prepare, aguardarApp } from "./fixtures";

for (const theme of ["dark", "light"] as const) {
  test(`controles de meta respeitam limites e preservam edição em ${theme}`, async ({
    page,
  }) => {
    await prepare(page, { theme, comHistorico: true });
    await page.goto("/adaptive");
    await aguardarApp(page);
    await page.getByRole("tab", { name: "Metas", exact: true }).click();
    const coverage = page.getByRole("spinbutton", { name: "Cobertura alvo %", exact: true });
    await coverage.fill("99");
    await page.getByRole("button", { name: "Aumentar Cobertura alvo %", exact: true }).click();
    await expect(coverage).toHaveValue("100");
    await expect(
      page.getByRole("button", { name: "Aumentar Cobertura alvo %", exact: true }),
    ).toBeDisabled();
    await coverage.fill("0");
    await expect(
      page.getByRole("button", { name: "Diminuir Cobertura alvo %", exact: true }),
    ).toBeDisabled();
    await coverage.fill("");
    await coverage.fill("75");
    await coverage.press("ArrowUp");
    await expect(coverage).toHaveValue("76");
    await page.getByRole("tab", { name: "Diagnóstico", exact: true }).click();
    await page.getByRole("tab", { name: "Metas", exact: true }).click();
    await expect(coverage).toHaveValue("76");
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")),
    ).toEqual([]);
  });

  test(`busca agrupada limpa a consulta e devolve foco em ${theme}`, async ({ page }) => {
    await prepare(page, { theme, comHistorico: true });
    await page.goto("/bank");
    await aguardarApp(page);
    const filters = page.getByRole("button", { name: "Filtros", exact: true });
    if (await filters.isVisible()) await filters.click();
    const search = page.getByRole("searchbox", { name: "Buscar no enunciado ou conteúdo" });
    await search.fill("matemática");
    await page.getByRole("button", { name: "Limpar busca", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Limpar busca", exact: true }),
    ).toBeDisabled();
    const result = await new AxeBuilder({ page }).analyze();
    expect(
      result.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")),
    ).toEqual([]);
  });
}
