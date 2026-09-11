import { expect, test } from "@playwright/test";
import { aguardarApp, seedState, STORE_KEY } from "./fixtures";

test("UFT real native content loads in Banco and can be answered without PDF", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    { key: STORE_KEY, value: JSON.stringify(seedState({ provider: "uft" })) },
  );
  await page.goto("/bank");
  await aguardarApp(page);
  const filters = page.getByRole("button", { name: "Filtros" });
  if (await filters.isVisible()) await filters.click();
  await page
    .getByRole("searchbox", { name: "Buscar no enunciado ou conteúdo" })
    .fill("modelos atômicos");
  const closeFilters = page.getByRole("button", { name: "Fechar" });
  if (await closeFilters.isVisible()) await closeFilters.click();
  await expect(page.locator(".el-bankitem")).toHaveCount(1);
  await expect(page.locator(".el-bankitem")).toContainText("Q29");
  await expect(page.locator(".el-bankitem")).not.toContainText("Enunciado na prova oficial");
  await page.getByRole("button", { name: "Selecionar visíveis" }).click();
  await page.getByRole("button", { name: "Treinar selecionadas" }).click();
  await expect(page).toHaveURL(/\/exam\//);
  await expect(
    page.getByText("Sobre os modelos atômicos, assinale a alternativa INCORRETA."),
  ).toBeVisible();
  await expect(page.getByText("Enunciado na prova oficial", { exact: true })).toHaveCount(0);
  await expect(page.locator(".answer")).toHaveCount(4);
  await page.locator(".answer").nth(1).click();
  await expect(page.locator(".answer").nth(1)).toHaveClass(/selected/);
  await page.reload();
  await aguardarApp(page);
  await expect(page.locator(".answer").nth(1)).toHaveClass(/selected/);
  expect(errors).toEqual([]);
});
