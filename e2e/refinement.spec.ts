import { expect, test } from "@playwright/test";
import { aguardarApp, INSTANTE_FIXO, prepararCaptura, prepare } from "./fixtures";
import { UI_SCREENS } from "./ui-screens";

// Review artifacts cover the requested widths; canonical snapshots stay Linux.
for (const width of [375, 425, 768, 1280, 1440]) {
  for (const theme of ["dark", "light"] as const) {
    test(`composição ${width} ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "Matriz já define o viewport");
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(INSTANTE_FIXO);
      await prepare(page, { theme, comHistorico: true });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const screen of UI_SCREENS) {
        await page.goto(screen.url);
        await aguardarApp(page);
        await expect(page.locator("main h1")).toBeVisible();
        await prepararCaptura(page);
        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth > window.innerWidth,
          main:
            document.querySelector("main")!.getBoundingClientRect().right >
            window.innerWidth + 1,
        }));
        expect(overflow, screen.name).toEqual({ page: false, main: false });
        await page.screenshot({
          path: `ui-review/${width}-${theme}/${screen.name}.png`,
          fullPage: true,
        });
      }
      expect(errors).toEqual([]);
    });
  }
}

test("menu mobile abre todas as rotas e devolve o foco", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await prepare(page, { comHistorico: true });
  await page.goto("/");
  await aguardarApp(page);
  const more = page.getByRole("button", { name: "Mais", exact: true });
  await more.click();
  const nav = page.getByRole("navigation", { name: "Todas as páginas" });
  await expect(nav.getByRole("link")).toHaveCount(12);
  await expect(nav.getByRole("link", { name: /Centro de IA/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await more.click();
  await nav.getByRole("link", { name: "Conta", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(nav).toBeHidden();
});

test("paleta mantém foco, seleção visível e movimento reduzido", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepare(page);
  await page.goto("/");
  await aguardarApp(page);
  const trigger = page.getByRole("button", { name: "Buscar páginas e ações" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("combobox");
  await expect(search).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  for (let i = 0; i < 15; i++) await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { selected: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
