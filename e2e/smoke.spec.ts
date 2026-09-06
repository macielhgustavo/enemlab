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
  { url: "/bank", nome: "Banco", marca: /banco/i },
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
