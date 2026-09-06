import { defineConfig, devices } from "@playwright/test";

/**
 * QA visual e de fumaça.
 *
 * `channel: "chrome"` em vez do Chromium empacotado: o download do build do
 * Playwright não passa neste ambiente (o CDN responde, mas o downloader
 * estoura em 30s), e os runners do GitHub Actions já trazem o Chrome. Se o
 * download voltar a funcionar, tirar o channel é uma linha.
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT || 3100);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Estado é por navegador (localStorage), então testes que mexem na mesma
  // origem não podem correr juntos sem se atrapalhar.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  expect: {
    toHaveScreenshot: {
      /**
       * Tolerância deliberada. Fonte, antialiasing e sub-pixel mudam entre
       * máquinas; screenshot pixel-perfect entre Windows e runner Linux
       * reprova sem que nada tenha quebrado. 1,2% de pixels diferentes ainda
       * pega mudança de layout, cor e componente sumido — que é o que
       * queremos pegar — sem virar alarme falso semanal.
       */
      maxDiffPixelRatio: 0.012,
      threshold: 0.25,
      animations: "disabled",
      caret: "hide",
    },
  },

  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    channel: "chrome",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        channel: "chrome",
        viewport: { width: 390, height: 844 },
        isMobile: true,
      },
    },
  ],

  webServer: {
    // Build de produção: `next dev` recompila sob demanda e o primeiro
    // acesso a cada rota fica lento o bastante para gerar flake.
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
