#!/usr/bin/env node
// CLI de ingestão (§34).
//
//   npm run ingest -- ime --year 2025-2026
//   npm run ingest -- afa --year 2026 --report
//   npm run ingest -- all --dry-run
//
// Regras que a CLI garante, e não delega:
//
//   * `--dry-run` **nunca** escreve catálogo. É o modo padrão de quem está
//     conferindo, e um comando que escreve quando disse que não escreveria
//     é pior que um comando que não existe.
//   * Edição reprovada não vira catálogo, com ou sem flag.
//   * Reimportar duas vezes produz o mesmo catálogo (§35): a saída é
//     ordenada e determinística.
//
// Esta wave (v8.5.0) entrega a plataforma. Nenhum provider novo está
// registrado ainda, então `--provider` só aceita o que existe — a CLI
// recusa nome desconhecido em vez de fingir que importou.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOGO = join(RAIZ, "src", "lib", "catalog", "catalog.generated.json");

/**
 * Importadores registrados.
 *
 * Vazio de propósito nesta wave: a v8.5.0 entrega a plataforma, e cada
 * provider entra na sua própria PR depois de conferido. Uma CLI que aceita
 * qualquer nome e não faz nada é pior que uma que recusa.
 */
const IMPORTADORES = {
  // "ime": () => import("../src/lib/providers/ime/importer.mjs"),
};

function parseArgs(argv) {
  const args = { provider: null, year: null, dryRun: false, validate: false, report: false };
  const resto = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--validate") args.validate = true;
    else if (a === "--report") args.report = true;
    else if (a === "--year") args.year = argv[++i] ?? null;
    else if (a === "--provider") args.provider = argv[++i] ?? null;
    else if (!a.startsWith("--")) resto.push(a);
  }
  if (!args.provider && resto.length) args.provider = resto[0];
  return args;
}

function uso(codigo = 0) {
  console.log(`
Ingestão de provas

  npm run ingest -- <provider|all> [opções]

Opções
  --year <edição>   Só esta edição ("2026", "2025-2026")
  --dry-run         Valida e imprime o relatório sem escrever catálogo
  --validate        Só valida o catálogo existente
  --report          Imprime o relatório completo de cada edição
  --provider <id>   Alternativa a passar o provider posicionalmente

Providers com importador: ${Object.keys(IMPORTADORES).join(", ") || "(nenhum ainda)"}
`);
  process.exit(codigo);
}

function lerCatalogo() {
  if (!existsSync(CATALOGO)) return [];
  try {
    return JSON.parse(readFileSync(CATALOGO, "utf8"));
  } catch (e) {
    console.error(`catálogo ilegível em ${CATALOGO}: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Grava o catálogo de forma determinística.
 *
 * Ordenação estável e chave única por edição: rodar o importador duas vezes
 * precisa dar exatamente o mesmo arquivo, senão cada execução vira um diff
 * e ninguém mais consegue revisar o que de fato mudou.
 */
function escreverCatalogo(entradas) {
  const porChave = new Map();
  for (const e of entradas) {
    porChave.set(`${e.providerId}|${e.editionId}|${e.phase}`, e);
  }
  const ordenadas = [...porChave.values()].sort((a, b) => {
    if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
    if (a.year !== b.year) return b.year - a.year;
    if (a.editionId !== b.editionId) return a.editionId.localeCompare(b.editionId);
    return a.phase.localeCompare(b.phase);
  });

  mkdirSync(dirname(CATALOGO), { recursive: true });
  writeFileSync(CATALOGO, JSON.stringify(ordenadas, null, 2) + "\n", "utf8");
  return ordenadas.length;
}

function validarCatalogo(entradas) {
  const problemas = [];
  const vistos = new Set();

  for (const e of entradas) {
    const chave = `${e.providerId}|${e.editionId}|${e.phase}`;
    if (vistos.has(chave)) problemas.push(`edição duplicada no catálogo: ${chave}`);
    vistos.add(chave);

    if (e.validation === "blocked") {
      problemas.push(`edição bloqueada não deveria estar no catálogo: ${chave}`);
    }
    if (!Number.isInteger(e.questionCount) || e.questionCount < 1) {
      problemas.push(`contagem inválida em ${chave}: ${e.questionCount}`);
    }
    const soma = Object.values(e.subjects ?? {}).reduce((s, n) => s + n, 0);
    if (soma !== e.questionCount) {
      problemas.push(
        `soma das matérias (${soma}) difere da contagem (${e.questionCount}) em ${chave}`,
      );
    }
  }
  return problemas;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.provider) uso(1);

  const catalogo = lerCatalogo();

  if (args.validate) {
    const problemas = validarCatalogo(catalogo);
    if (problemas.length) {
      console.error(`catálogo inválido (${problemas.length} problema(s)):`);
      for (const p of problemas) console.error(`  ${p}`);
      process.exit(1);
    }
    console.log(`catálogo válido: ${catalogo.length} edição(ões)`);
    return;
  }

  const alvos =
    args.provider === "all" ? Object.keys(IMPORTADORES) : [args.provider];

  const desconhecidos = alvos.filter((p) => !(p in IMPORTADORES));
  if (desconhecidos.length) {
    console.error(`sem importador para: ${desconhecidos.join(", ")}`);
    console.error(
      Object.keys(IMPORTADORES).length
        ? `disponíveis: ${Object.keys(IMPORTADORES).join(", ")}`
        : "nenhum provider tem importador ainda — a v8.5.0 entrega só a plataforma",
    );
    process.exit(1);
  }

  if (!alvos.length) {
    console.log("nada a importar: nenhum provider tem importador registrado.");
    return;
  }

  const aceitas = [];
  const recusadas = [];

  for (const providerId of alvos) {
    const mod = await IMPORTADORES[providerId]();
    const resultado = await mod.importar({ year: args.year });

    for (const { edicao, relatorio } of resultado) {
      if (args.report) console.log(mod.formatar(relatorio), "\n");
      if (edicao) aceitas.push(edicao);
      else recusadas.push(relatorio);
    }
  }

  console.log(`aceitas:   ${aceitas.length}`);
  console.log(`recusadas: ${recusadas.length}`);
  for (const r of recusadas) {
    const fatais = r.issues.filter((i) => i.fatal).map((i) => i.code);
    console.log(`  ${r.providerId} ${r.editionId}: ${fatais.join(", ")}`);
  }

  if (args.dryRun) {
    console.log("\n--dry-run: nada foi escrito.");
    return;
  }

  const total = escreverCatalogo([...catalogo, ...aceitas]);
  console.log(`\ncatálogo escrito: ${total} edição(ões) em ${CATALOGO}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
