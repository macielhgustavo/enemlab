import { expect, test } from "@playwright/test";
import { aguardarApp, prepare, STORE_KEY } from "./fixtures";

test("trajetória mostra data-alvo e Home resume sem duplicar a tela", async ({ page }) => {
  await prepare(page, {
    provider: "enem",
    comHistorico: true,
    targetDate: "2026-11-08",
    weeklyQuestions: 140,
  });

  await page.goto("/");
  await aguardarApp(page);
  const trajectoryLink = page.locator(".dashboard-intro__trajectory");
  await expect(trajectoryLink).toBeVisible();
  await expect(trajectoryLink).toContainText(/dias|atualizar data/i);
  await trajectoryLink.click();

  await expect(page).toHaveURL(/\/trajetoria$/);
  await expect(page.getByRole("heading", { name: "Trajetória até a prova" })).toBeVisible();
  await expect(page.getByText("140", { exact: true }).first()).toBeVisible();
});

test("editar meta e data recalcula sem apagar histórico", async ({ page }) => {
  await prepare(page, {
    provider: "enem",
    comHistorico: true,
    targetDate: "2026-11-08",
    weeklyQuestions: 140,
  });
  await page.goto("/trajetoria");
  await aguardarApp(page);

  await page.getByLabel("Data-alvo").fill("2026-12-06");
  await page.getByLabel("Questões / semana").fill("210");
  await page.getByRole("button", { name: "Salvar metas" }).click();

  await expect(page.getByText("210", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("06/12/2026", { exact: true })).toBeVisible();

  const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), STORE_KEY);
  expect(state.state.db.attempts).toHaveLength(1);
  expect(state.state.db.studyIntelligence.providerConfig.enem.weeklyQuestions).toBe(210);
  expect(state.state.db.studyIntelligence.providerConfig.enem.targetDate).toBe("2026-12-06");
});

test("sem histórico a trajetória explica que ainda está calibrando", async ({ page }) => {
  await prepare(page, {
    provider: "enem",
    targetDate: "2026-11-08",
  });
  await page.goto("/trajetoria");
  await aguardarApp(page);

  await expect(page.getByText("calibração", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/baixa confiança/i).first()).toBeVisible();
});
