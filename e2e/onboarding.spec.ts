import { expect, test } from "@playwright/test";
import { aguardarApp, prepare } from "./fixtures";

test("primeiro uso configura prova, objetivo e rotina", async ({ page }) => {
  await prepare(page, { novoUsuario: true });
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);

  await expect(page.getByRole("heading", { name: /Qual prova você está preparando/i })).toBeVisible();
  await page.getByRole("button", { name: /ENEM/i }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("radio", { name: /Recuperação/i }).click();
  await page.locator("#onboarding-target-date").fill("2027-11-07");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("button", { name: "45 min" }).click();
  await page.locator("#onboarding-weekly-questions").fill("210");
  await page.getByRole("button", { name: "Salvar e abrir plano" }).click();

  await expect(page).toHaveURL(/\/plano$/);
  await aguardarApp(page);
  await expect(page.getByText("45 min", { exact: true }).first()).toBeVisible();

  await page.goto("/");
  await aguardarApp(page);
  await expect(page).toHaveURL(/\/$/);
});

test("usuário já configurado não é interrompido", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await aguardarApp(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/centro de controle/i)).toBeVisible();
});

test("histórico existente evita onboarding forçado", async ({ page }) => {
  await prepare(page, { novoUsuario: true, comHistorico: true });
  await page.goto("/");
  await aguardarApp(page);
  await expect(page).toHaveURL(/\/$/);
});
