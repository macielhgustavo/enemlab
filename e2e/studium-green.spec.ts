import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { aguardarApp, prepare } from "./fixtures";

const screens = [
  { name: "home", url: "/", heading: /bom dia|boa tarde|boa noite/i },
  { name: "adaptive", url: "/adaptive", heading: "Adaptive" },
] as const;

for (const theme of ["dark", "light"] as const) {
  test(`áreas e seletor do Adaptive acessíveis em ${theme}`, async ({ page }) => {
    await prepare(page, { theme, comHistorico: true });
    await page.goto("/adaptive");
    await aguardarApp(page);
    for (const name of ["Diagnóstico", "Metas", "Histórico"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      const report = await new AxeBuilder({ page }).analyze();
      expect(report.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    }
    await page.getByRole("button", { name: "Escolher objetivo" }).click();
    const report = await new AxeBuilder({ page }).analyze();
    expect(report.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  });
}

test("objetivo por teclado e metas continuam acessíveis no novo workspace", async ({
  page,
}) => {
  await prepare(page, { theme: "dark", comHistorico: true });
  await page.goto("/adaptive");
  await aguardarApp(page);
  await page.getByRole("button", { name: "Escolher objetivo" }).click();
  const selected = page.getByRole("radio", { name: /^Balanceado/ });
  await selected.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /^Recuperação/ })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Escolher objetivo" })).toContainText(
    "Recuperação",
  );
  await page.getByRole("tab", { name: "Metas", exact: true }).click();
  await page.getByLabel("Questões/semana").fill("180");
  await page.getByRole("tab", { name: "Diagnóstico", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Execução e tempo" })).toBeVisible();
  await page.getByRole("tab", { name: "Metas", exact: true }).click();
  await expect(page.getByLabel("Questões/semana")).toHaveValue("180");
});

for (const width of [375, 425, 768, 1280, 1440]) {
  for (const theme of ["dark", "light"] as const) {
    for (const screen of screens) {
      test(`${screen.name} ${theme} a ${width}px preserva leitura e ações`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await prepare(page, { theme, comHistorico: true });
        await page.goto(screen.url);
        await aguardarApp(page);

        await expect(
          page.getByRole("heading", { level: 1, name: screen.heading }),
        ).toBeVisible();
        const widthInfo = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        }));
        expect(widthInfo.document).toBeLessThanOrEqual(widthInfo.viewport + 1);

        if (screen.name === "adaptive") {
          await expect(
            page.getByRole("button", { name: "Treinar objetivo · 15" }),
          ).toBeVisible();
        }

        if (process.env.STUDIUM_REVIEW_DIR) {
          mkdirSync(process.env.STUDIUM_REVIEW_DIR, { recursive: true });
          await page.screenshot({
            path: join(process.env.STUDIUM_REVIEW_DIR, `${screen.name}-${theme}-${width}.png`),
            fullPage: true,
            animations: "disabled",
          });
        }
      });
    }
  }
}
