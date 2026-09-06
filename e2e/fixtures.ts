import type { Page } from "@playwright/test";

/**
 * Estado local determinístico.
 *
 * O app guarda tudo em `localStorage` sob uma chave só, então o teste não
 * precisa da rede nem da API do ENEM para ter uma tela cheia. Isso importa:
 * teste que depende de `api.enem.dev` falha quando o problema é do servidor
 * de outra pessoa, e aí ninguém confia mais no vermelho.
 */
export const STORE_KEY = "enem_lab_v7";

export interface SeedOptions {
  provider?: "enem" | "ita";
  theme?: "dark" | "light";
  /** Com histórico, a Home mostra números em vez do estado vazio. */
  comHistorico?: boolean;
}

function tentativaEnem() {
  const linhas = Array.from({ length: 15 }, (_, i) => ({
    index: i + 1,
    year: 2023,
    area: ["matematica", "ciencias-natureza", "linguagens", "ciencias-humanas"][i % 4],
    content: "Conteúdo de teste",
    selected: "A",
    correct: i % 3 === 0 ? "B" : "A",
    isCorrect: i % 3 !== 0,
    timeSec: 60 + i,
    confidence: "certeza",
  }));
  return {
    id: "a_fixture_enem",
    providerId: "enem",
    year: 2023,
    lang: "ingles",
    mode: "sprint15",
    area: "all",
    minutes: 30,
    strict: false,
    questionRefs: linhas.map((r) => ({
      providerId: "enem",
      index: r.index,
      year: 2023,
      language: "ingles",
      discipline: r.area,
    })),
    answers: {},
    confidence: {},
    flags: {},
    timeQ: {},
    elapsed: 1080,
    questionSec: 1080,
    essaySec: 0,
    startedAt: "2026-09-05T10:00:00.000Z",
    finishedAt: "2026-09-05T10:18:00.000Z",
    result: {
      rows: linhas,
      correct: linhas.filter((r) => r.isCorrect).length,
      total: linhas.length,
      blank: 0,
    },
    essay: null,
  };
}

export function seedState(opts: SeedOptions = {}) {
  const { provider = "enem", theme = "dark", comHistorico = false } = opts;
  return {
    state: {
      db: {
        v: 6,
        schema: 6.6,
        build: "e2e",
        theme,
        activeProvider: provider,
        attempts: comHistorico ? [tentativaEnem()] : [],
        notes: {},
        srs: {},
        sessions: [],
        goals: { questions: 150, essays: 2, reviews: 30 },
        lastOpened: null,
        lastBackupAt: null,
      },
    },
    version: 0,
  };
}

/**
 * Semeia antes de qualquer script da página rodar. Precisa ser add-init, não
 * um `evaluate` depois do load: a store lê o storage na hidratação, e semear
 * tarde faz o teste medir a tela errada.
 */
export async function prepare(page: Page, opts: SeedOptions = {}) {
  await interceptarApi(page);
  const payload = JSON.stringify(seedState(opts));
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
      // Só o storage: o tema é aplicado antes da pintura pelo script de boot
      // do layout, que lê esta mesma chave. Tocar em `document.documentElement`
      // aqui não funciona — no init script o documento ainda não existe.
    },
    [STORE_KEY, payload] as const,
  );
}

/**
 * Responde pela API do ENEM com um lote fixo.
 *
 * Sem isto, o Banco chama `api.enem.dev` de verdade e o teste reprova quando
 * o problema é o servidor de outra pessoa. Um vermelho que não é culpa do
 * código é pior que teste nenhum: ensina a ignorar o vermelho.
 */
export async function interceptarApi(page: Page) {
  await page.route("**/api.enem.dev/**", async (route) => {
    const url = route.request().url();
    if (!/\/questions/.test(url)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    const questoes = Array.from({ length: 12 }, (_, i) => ({
      index: i + 1,
      year: 2023,
      language: "ingles",
      discipline: ["matematica", "ciencias-natureza", "linguagens", "ciencias-humanas"][i % 4],
      context: `Enunciado de teste da questão ${i + 1}.`,
      alternativesIntroduction: "Assinale a alternativa correta.",
      alternatives: ["A", "B", "C", "D", "E"].map((letter) => ({
        letter,
        text: `Alternativa ${letter}`,
        file: null,
        isCorrect: letter === "B",
      })),
      correctAlternative: "B",
      files: [],
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(questoes),
    });
  });
}

/** Espera a hidratação: antes disso a Home devolve esqueleto, não conteúdo. */
export async function aguardarApp(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.locator("main, .content").first().waitFor({ state: "visible" });
}
