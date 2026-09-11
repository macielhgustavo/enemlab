import { expect, test } from "@playwright/test";
import { aguardarApp, prepare, STORE_KEY } from "./fixtures";

/**
 * Fumaça: cada rota abre, hidrata e mostra o conteúdo dela — não um erro,
 * não um esqueleto eterno.
 *
 * Um erro de renderização no cliente não aparece no `npm run build`, e foi
 * exatamente assim que bugs de painel passaram batido antes.
 */

const ROTAS: { url: string; nome: string; marca: RegExp }[] = [
  { url: "/", nome: "Início", marca: /centro de controle/i },
  { url: "/practice", nome: "Treinar", marca: /novo treino/i },
  { url: "/bank", nome: "Banco", marca: /banco/i },
  { url: "/ai", nome: "Centro de IA", marca: /centro de ia|inteligência/i },
  { url: "/plano", nome: "Plano", marca: /plano|prontidão/i },
  { url: "/mastery", nome: "Domínio", marca: /mapa de domínio/i },
  { url: "/srs", nome: "Revisões", marca: /revis/i },
  { url: "/history", nome: "Histórico", marca: /histórico/i },
  { url: "/data", nome: "Dados", marca: /dados|backup/i },
  { url: "/account", nome: "Conta", marca: /conta|sincroniza/i },
];

for (const rota of ROTAS) {
  test(`${rota.nome} abre sem erro de cliente`, async ({ page }) => {
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") erros.push(m.text());
    });

    await prepare(page, { comHistorico: true });
    await page.goto(rota.url);
    await aguardarApp(page);

    await expect(page.locator("body")).toContainText(rota.marca);
    expect(erros, `erros de console em ${rota.url}`).toEqual([]);
  });
}

test("resultado abre a partir de uma tentativa semeada", async ({ page }) => {
  await prepare(page, { comHistorico: true });
  await page.goto("/result/a_fixture_enem");
  await aguardarApp(page);

  // 10 de 15 acertos na fixture: se a correção mudar, este número muda.
  await expect(page.locator("body")).toContainText("10/15");
  await expect(page.locator("body")).toContainText(/ENEM 2023/i);
});

test("a prova ativa troca e a Home acompanha", async ({ page }) => {
  await prepare(page, { provider: "enem", comHistorico: true });
  await page.goto("/");
  await aguardarApp(page);

  const gatilho = page.locator(".el-provider__trigger");
  await expect(gatilho).toContainText("ENEM");

  await gatilho.click();
  await expect(page.getByRole("menuitemradio", { name: /ITA/ })).toBeVisible();
  await page.getByRole("menuitemradio", { name: /ITA/ }).click();

  await expect(gatilho).toContainText("ITA");
  // O histórico é do ENEM: no ITA a taxa não pode aparecer como 0%.
  await expect(page.locator(".el-provider__trigger")).toContainText("Prova ativa");
});

const VESTIBULARES_REFERENCIA = [
  { id: "ita", alternatives: 5 },
  { id: "ime", alternatives: 5 },
  { id: "fuvest", alternatives: 5 },
  { id: "afa", alternatives: 4 },
  { id: "epcar", alternatives: 4 },
  { id: "unicamp", alternatives: 5 },
  { id: "uel", alternatives: 5 },
  { id: "puc-sp", alternatives: 5 },
  { id: "udesc", alternatives: 5 },
  { id: "acafe", alternatives: 5 },
];

for (const provider of VESTIBULARES_REFERENCIA) {
  test(`${provider.id} selecionado abre e permite responder`, async ({ page }) => {
    await prepare(page, { provider: provider.id });
    await page.goto("/practice");
    await aguardarApp(page);

    await expect(page.locator("#ref-provider")).toHaveValue(provider.id);
    await page.getByRole("button", { name: "Começar vestibular" }).click();
    await expect(page).toHaveURL(/\/exam\//);
    await expect(page.getByText("Enunciado na prova oficial", { exact: true })).toBeVisible();

    const alternatives = page.locator(".answer");
    await expect(alternatives).toHaveCount(provider.alternatives);
    await alternatives.first().click();
    await expect(alternatives.first()).toHaveClass(/selected/);
  });
}

test("o tutor IA usa o contexto da questão e respeita a escada de assistência", async ({ page }) => {
  await prepare(page, { provider: "enem", comHistorico: true });
  await page.goto("/practice");
  await aguardarApp(page);

  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await expect(page).toHaveURL(/\/exam\//);

  const ativador = page.getByRole("button", { name: /Ativar camada IA/ });
  await expect(ativador).toBeVisible();
  await ativador.click();
  await expect(page.getByRole("complementary", { name: "Profundidade da assistência da IA" })).toBeVisible();

  await page.getByRole("button", { name: /^Orientação:/ }).click();
  await expect(page.getByText("Pista 1 de 6")).toBeVisible();
  await expect(page.locator(".studentAIDepthMeter span.active")).toHaveCount(1);
  await expect(page.locator(".studentAIRevealedAnswer")).toHaveCount(0);
  await expect(page.locator(".studentAISemanticLegend > span")).toHaveCount(1);

  const primeiraAlternativa = page.locator(".answer").first();
  await primeiraAlternativa.click();
  await expect(primeiraAlternativa).toHaveClass(/selected/);
  await page.getByRole("button", { name: "Analisar escolha" }).click();
  await expect(page.getByText("Alternativa A", { exact: true })).toBeVisible();
  await expect(page.locator(".studentAIRevealedAnswer")).toHaveCount(0);

  await page.getByRole("button", { name: "Fazer uma pergunta livre" }).click();
  const composer = page.getByRole("textbox", { name: "Mensagem para o tutor IA" });
  await composer.fill("Resolva completamente essa questão");
  await page.getByRole("button", { name: "Enviar pergunta" }).click();
  await expect(page.getByRole("heading", { name: "Solução completa", exact: true })).toBeVisible();
  await expect(page.locator(".studentAIDepthMeter span.active")).toHaveCount(6);
  await expect(page.locator(".studentAIRevealedAnswer")).toContainText("B");

  const trace = await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const persisted = JSON.parse(raw) as {
      state?: {
        db?: {
          attempts?: Array<{
            id: string;
            aiAssistance?: Record<
              string,
              {
                requests: number;
                maxLevel: number;
                answerRevealed: boolean;
                modes: string[];
                recent: unknown[];
              }
            >;
          }>;
        };
      };
    };
    const attemptId = window.location.pathname.split("/").filter(Boolean).at(-1);
    const attempt = persisted.state?.db?.attempts?.find((item) => item.id === attemptId);
    return Object.values(attempt?.aiAssistance || {})[0] || null;
  }, STORE_KEY);

  expect(trace).toMatchObject({
    requests: 3,
    maxLevel: 6,
    answerRevealed: true,
    modes: ["hint", "explain-alternative", "chat"],
  });
  expect(trace?.recent).toHaveLength(3);
});

test("o tema alterna e fica", async ({ page }) => {
  await prepare(page, { theme: "dark" });
  await page.goto("/");
  await aguardarApp(page);

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /tema|claro|escuro/i.test(b.getAttribute("aria-label") || b.title || ""),
    );
    btn?.click();
  });

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("a paleta de comandos abre, busca e fecha no Esc", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await aguardarApp(page);

  await page.keyboard.press("ControlOrMeta+k");
  const busca = page.getByRole("combobox");
  await expect(busca).toBeVisible();

  await busca.fill("plano");
  await expect(page.getByRole("option").first()).toContainText(/plano/i);

  await page.keyboard.press("Escape");
  await expect(busca).toBeHidden();

  await page.keyboard.press("ControlOrMeta+k");
  await busca.fill("centro de ia");
  await expect(page.getByRole("option").first()).toContainText(/Centro de IA/i);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ai$/);
});
