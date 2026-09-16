import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { aguardarApp, prepare } from "./fixtures";

const screens = [
  { name: "home", url: "/", heading: /bom dia|boa tarde|boa noite/i },
  { name: "adaptive", url: "/adaptive", heading: "Seu próximo estudo, com direção." },
] as const;

for (const width of [375, 425, 768, 1280, 1440]) {
  for (const theme of ["dark", "light"] as const) {
    for (const screen of screens) {
      test(`${screen.name} ${theme} a ${width}px preserva leitura e ações`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await prepare(page, { theme, comHistorico: true });
        await page.goto(screen.url);
        await aguardarApp(page);

        await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
        const widthInfo = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        }));
        expect(widthInfo.document).toBeLessThanOrEqual(widthInfo.viewport + 1);

        if (screen.name === "adaptive") {
          await expect(page.getByRole("button", { name: "Treinar objetivo · 15" })).toBeVisible();
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
