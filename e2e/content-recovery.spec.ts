import { expect, test } from "@playwright/test";
import { aguardarApp, prepare } from "./fixtures";

test("gargalo da Home abre ficha acionável", async ({ page }) => {
  await prepare(page, {
    comHistorico: true,
    questoesHistorico: 15,
    acertosHistorico: 3,
  });
  await page.goto("/");
  await aguardarApp(page);

  const gargalos = page.locator(".dash-bottlenecks");
  await expect(gargalos.getByText("Conteúdo de teste", { exact: true })).toBeVisible();
  await gargalos.getByRole("link", { name: "Conteúdo de teste" }).click();

  await expect(page).toHaveURL(/\/content\/enem\/Conte%C3%BAdo%20de%20teste/);
  await expect(page.getByRole("heading", { name: "Conteúdo de teste" })).toBeVisible();
  await expect(page.getByText("gargalo confirmado", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Treinar este conteúdo/i })).toBeVisible();
});

test("amostra curta aparece como calibração e a nota persiste localmente", async ({ page }) => {
  await prepare(page, {
    comHistorico: true,
    questoesHistorico: 3,
    acertosHistorico: 0,
  });
  await page.goto("/content/enem/Conte%C3%BAdo%20de%20teste");
  await aguardarApp(page);

  await expect(page.getByText("calibração", { exact: true })).toBeVisible();
  await expect(page.getByText(/menos de 4 respostas/i)).toBeVisible();

  const note = page.locator("#content-personal-note");
  await note.fill("Rever a ideia central antes do próximo bloco.");
  await page.getByRole("heading", { name: "Padrões recentes" }).click();
  await page.reload();
  await aguardarApp(page);
  await expect(page.locator("#content-personal-note")).toHaveValue(
    "Rever a ideia central antes do próximo bloco.",
  );
});
