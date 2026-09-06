import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listSources } from "@/lib/sources";

const RAIZ = join(__dirname, "..", "..", "..");

/**
 * Garantias que valem sem rede (§45).
 *
 * A CLI e o audit são scripts em Node puro, fora do TypeScript compilado.
 * Estes testes leem o código deles como texto e verificam as promessas que
 * seria caro descobrir quebradas em produção — sem tocar em nenhum servidor.
 */

function fonteDaCli(): string {
  return readFileSync(join(RAIZ, "scripts", "ingest.mjs"), "utf8");
}

function fonteDoAudit(): string {
  return readFileSync(join(RAIZ, "scripts", "sources-audit.mjs"), "utf8");
}

describe("idempotência do catálogo", () => {
  it("a escrita deduplica por provider, edição e fase", () => {
    // §35: rodar o importador duas vezes tem que dar o mesmo catálogo. A
    // deduplicação por chave é o que impede a segunda execução de dobrar
    // cada edição.
    const cli = fonteDaCli();
    expect(cli).toMatch(/porChave\.set\(`\$\{e\.providerId\}\|\$\{e\.editionId\}\|\$\{e\.phase\}`/);
  });

  it("a saída é ordenada, para o diff ser revisável", () => {
    // Sem ordenação estável, cada execução embaralha o arquivo e ninguém
    // consegue ver o que de fato mudou.
    const cli = fonteDaCli();
    expect(cli).toContain("localeCompare");
    expect(cli).toMatch(/\.sort\(\(a, b\) =>/);
  });

  it("dry-run retorna antes de escrever", () => {
    const cli = fonteDaCli();
    const posDryRun = cli.indexOf("if (args.dryRun)");
    const posEscrita = cli.indexOf("escreverCatalogo([...catalogo");
    expect(posDryRun).toBeGreaterThan(-1);
    expect(posEscrita).toBeGreaterThan(posDryRun);
  });

  it("a validação recusa edição bloqueada no catálogo", () => {
    const cli = fonteDaCli();
    expect(cli).toContain('e.validation === "blocked"');
  });

  it("a validação confere a soma das matérias contra a contagem", () => {
    // Uma edição que diz ter 40 questões mas soma 38 por matéria tem um
    // erro de parser que passaria despercebido na interface.
    const cli = fonteDaCli();
    expect(cli).toContain("soma das matérias");
  });
});

describe("simulação de reimportação", () => {
  /** Mesma deduplicação e ordenação que a CLI aplica. */
  function escrever(entradas: { providerId: string; editionId: string; phase: string; year: number }[]) {
    const porChave = new Map<string, (typeof entradas)[number]>();
    for (const e of entradas) porChave.set(`${e.providerId}|${e.editionId}|${e.phase}`, e);
    return [...porChave.values()].sort((a, b) => {
      if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
      if (a.year !== b.year) return b.year - a.year;
      if (a.editionId !== b.editionId) return a.editionId.localeCompare(b.editionId);
      return a.phase.localeCompare(b.phase);
    });
  }

  const edicoes = [
    { providerId: "ita", editionId: "2026", phase: "first", year: 2026 },
    { providerId: "ita", editionId: "2025", phase: "first", year: 2025 },
    { providerId: "enem", editionId: "2023", phase: "day1", year: 2023 },
  ];

  it("importar duas vezes produz exatamente o mesmo catálogo", () => {
    const uma = escrever(edicoes);
    const duas = escrever([...edicoes, ...edicoes]);
    expect(JSON.stringify(duas)).toBe(JSON.stringify(uma));
  });

  it("a ordem de entrada não muda a saída", () => {
    const a = escrever(edicoes);
    const b = escrever([...edicoes].reverse());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("reimportar uma edição substitui, não duplica", () => {
    const atualizada = { providerId: "ita", editionId: "2026", phase: "first", year: 2026 };
    const r = escrever([...edicoes, atualizada]);
    expect(r.filter((e) => e.providerId === "ita" && e.editionId === "2026")).toHaveLength(1);
  });
});

describe("audit de fontes", () => {
  it("não roda em teste unitário", () => {
    // §45: audit usa rede. Se ele entrasse no `npm test`, um PR passaria a
    // falhar por causa do servidor de outra pessoa.
    const pkg = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
    expect(pkg.scripts.test).not.toContain("sources-audit");
    expect(pkg.scripts["sources:audit"]).toBe("node scripts/sources-audit.mjs");
  });

  it("cobre toda fonte registrada", () => {
    // O audit repete a lista de fontes porque roda em Node puro, sem build.
    // Este teste é o que impede as duas listas de divergirem em silêncio.
    const audit = fonteDoAudit();
    for (const fonte of listSources()) {
      expect(audit, `fonte ${fonte.id} não está no audit`).toContain(fonte.id);
    }
  });

  it("trata 404 previsto como conhecimento, não como falha", () => {
    // O Português da 2ª fase do ITA não existe antes de 2025. O que deve
    // assustar é ele deixar de dar 404 — significa edição nova por ingerir.
    const audit = fonteDoAudit();
    expect(audit).toContain("esperado404");
    expect(audit).toContain('r.status === 404');
  });
});
