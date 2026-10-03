import { expect, test } from "@playwright/test";
import { aguardarApp, prepare } from "./fixtures";

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
  { url: "/redacao", nome: "Redação", marca: /treino de redação/i },
  { url: "/bank", nome: "Banco", marca: /banco/i },
  { url: "/plano", nome: "Plano", marca: /plano|prontidão/i },
  { url: "/trajetoria", nome: "Trajetória", marca: /trajetória até a prova/i },
  { url: "/simulado", nome: "Simulado", marca: /simulado completo/i },
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

test("modo ENEM-only não oferece troca de provider", async ({ page }) => {
  await prepare(page, { provider: "enem", comHistorico: true });
  await page.goto("/");
  await aguardarApp(page);

  await expect(page.locator(".el-provider__trigger")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("option", { name: /Trocar para/i })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("provider antigo salvo não reativa vestibular", async ({ page }) => {
  await prepare(page, { provider: "ita" });
  await page.goto("/");
  await aguardarApp(page);

  // Sem configuração ENEM anterior, a migração pode pedir onboarding, mas a
  // única prova oferecida deve ser ENEM.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("button", { name: /ENEM|Exame Nacional/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /ITA|Instituto Tecnológico/i })).toHaveCount(0);
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
});


test("a navegação prioriza o caminho recomendado e preserva ferramentas avançadas", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await aguardarApp(page);

  const desktop = page.locator(".railnav");
  await expect(desktop.getByRole("link", { name: "Plano de hoje" })).toBeVisible();
  await expect(desktop.getByRole("link", { name: "Treino manual" })).not.toBeVisible();
  await expect(desktop.getByRole("link", { name: "Motor adaptativo" })).not.toBeVisible();

  await page.locator(".el-rail-more__summary").click();
  await expect(desktop.getByRole("link", { name: "Simulado" })).toBeVisible();
  await expect(desktop.getByRole("link", { name: "Treino manual" })).toBeVisible();
  await expect(desktop.getByRole("link", { name: "Motor adaptativo" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = page.locator(".mobilebar");
  await expect(mobile.getByRole("link", { name: "Plano" })).toBeVisible();
  await expect(mobile.getByText("Treino", { exact: true })).not.toBeVisible();
});

test("Home leva da próxima ação até sessão e resultado", async ({ page }) => {
  await prepare(page);
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/");
  await aguardarApp(page);

  const mission = page.locator(".dash-mission");
  await expect(mission).toContainText("Montar seu primeiro treino");
  await mission.getByRole("link", { name: /Montar treino/i }).click();
  await expect(page).toHaveURL(/\/practice$/);

  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await expect(page).toHaveURL(/\/exam\//);
  await expect(page.locator(".answer").first()).toBeVisible();

  await page.locator(".answer").first().click();
  await page.getByRole("button", { name: /Finalizar e corrigir/i }).click();

  await expect(page).toHaveURL(/\/result\//);
  await expect(page.locator("body")).toContainText(/Próxima ação|Resultado/i);
});
