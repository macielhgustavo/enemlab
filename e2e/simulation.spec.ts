import { expect, test } from "@playwright/test";
import { aguardarApp, prepare } from "./fixtures";

test("simulado preserva estado e fecha o ciclo até revisão", async ({ page }) => {
  await prepare(page, { provider: "enem" });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/simulado");
  await aguardarApp(page);

  await expect(page.getByRole("heading", { name: "Simulado completo" })).toBeVisible();
  await expect(page.locator("#simulation-entry")).toBeVisible();
  await page.getByRole("button", { name: /Iniciar simulado/i }).click();

  await expect(page).toHaveURL(/\/exam\//);
  await expect(page.locator(".answer").first()).toBeVisible();
  await expect(page.locator(".sidebar")).toContainText(/Simulado/i);
  await expect(page.locator(".sidebar")).toContainText(/modo rígido/i);

  await page.locator(".answer").first().click();
  await expect(page.locator(".answer").first()).toHaveClass(/selected/);

  await page.getByRole("button", { name: /Salvar e sair/i }).click();
  await expect(page).toHaveURL(/\/history$/);
  await aguardarApp(page);

  await expect(page.locator(".el-histitem").first()).toContainText(/simulado/i);
  await page.locator(".el-histitem").first().getByRole("link", { name: /Continuar/i }).click();

  await expect(page).toHaveURL(/\/exam\//);
  await expect(page.locator(".answer").first()).toHaveClass(/selected/);

  await page.getByRole("button", { name: /Finalizar e corrigir/i }).click();
  await expect(page).toHaveURL(/\/result\//);
  await aguardarApp(page);

  await expect(page.locator("body")).toContainText(/Resultado · simulado/i);
  await expect(page.getByRole("heading", { name: /Resumo do simulado/i })).toBeVisible();
  await expect(page.locator("body")).toContainText(/não é nota TRI oficial nem previsão de aprovação/i);

  await page.getByRole("link", { name: /Revisar questão a questão/i }).first().click();
  await expect(page).toHaveURL(/\/result\/[^/]+\/review$/);
  await expect(page.locator("body")).toContainText(/revis/i);
});
