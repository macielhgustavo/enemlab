import { expect, test } from "@playwright/test";
import { aguardarApp, prepare } from "./fixtures";

test("redação independente salva versões, avaliação e histórico", async ({ page }) => {
  await prepare(page, { provider: "enem" });
  await page.goto("/redacao");
  await aguardarApp(page);

  await expect(page.getByRole("heading", { name: "Treino de redação" })).toBeVisible();
  const firstTheme = page.locator(".el-essay-theme-grid .el-card").first();
  const theme = (await firstTheme.getByRole("heading").textContent())?.trim() ?? "";
  await firstTheme.getByRole("button", { name: /Começar/i }).click();

  await expect(page).toHaveURL(/\/redacao\/essay_/);
  await expect(page.getByRole("heading", { name: theme })).toBeVisible();

  const text = "Introdução de teste. Desenvolvimento com argumento. Conclusão com proposta.";
  await page.locator("#essay-text").fill(text);
  await page.locator("#essay-repertoire").fill("Repertório de teste.");
  await page.locator("#essay-improvements").fill("Melhorar a coesão.");
  await page.getByRole("button", { name: /Salvar versão/i }).click();
  await expect(page.getByText(/1 versão/i)).toBeVisible();

  await page.getByRole("button", { name: /Concluir texto/i }).click();
  await expect(page.getByText("concluída", { exact: true })).toBeVisible();

  await page.getByLabel(/C1/i).selectOption("160");
  await page.getByLabel(/C2/i).selectOption("120");
  await page.getByLabel(/C3/i).selectOption("160");
  await page.getByLabel(/C4/i).selectOption("120");
  await page.getByLabel(/C5/i).selectOption("160");
  await page.getByRole("button", { name: "Registrar avaliação" }).click();

  await expect(page.getByText("Autoavaliação", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("C1:").last()).toBeVisible();

  await page.goto("/redacao");
  await aguardarApp(page);
  await expect(page.getByText(theme, { exact: true }).last()).toBeVisible();
  await expect(page.getByText("160/200", { exact: true }).first()).toBeVisible();

  await page.reload();
  await aguardarApp(page);
  await expect(page.getByText(theme, { exact: true }).last()).toBeVisible();
});

test("feedback externo deixa a origem explícita", async ({ page }) => {
  await prepare(page, { provider: "enem" });
  await page.goto("/redacao");
  await aguardarApp(page);

  await page.locator(".el-essay-theme-grid .el-card").first().getByRole("button", { name: /Começar/i }).click();
  await page.locator("#essay-text").fill("Texto para feedback externo.");
  await page.getByRole("button", { name: /Concluir texto/i }).click();

  await page.getByLabel("Origem").selectOption("external");
  await page.getByLabel("Quem forneceu").fill("Professor de redação");
  await page.getByLabel(/C1/i).selectOption("200");
  await page.getByLabel("Comentário da avaliação").fill("Boa estrutura; revisar repertório.");
  await page.getByRole("button", { name: "Registrar avaliação" }).click();

  await expect(page.getByText("Professor de redação", { exact: true })).toBeVisible();
  await expect(page.getByText("externo/manual", { exact: true })).toBeVisible();
  await expect(page.getByText("Boa estrutura; revisar repertório.", { exact: true })).toBeVisible();
});
