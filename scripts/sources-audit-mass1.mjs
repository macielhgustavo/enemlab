#!/usr/bin/env node
// Auditor complementar das fontes ativadas pela Mass Ingestion 1.
// Mantido separado do auditor histórico para evitar acoplar o volume novo às
// regras especiais de Wayback/FAB que já existem em sources-audit.mjs.

const TIMEOUT_MS = 20_000;

const FONTES = [
  {
    providerId: "eear",
    sourceId: "eear-corpus-reference",
    documentos: [
      {
        role: "archive-page",
        url: "https://ingresso.eear.fab.mil.br/SOO/home/provas_anteriores.php?sigla_conc=%25",
        informational: true,
      },
    ],
  },
  {
    providerId: "fatec",
    sourceId: "fatec-official-archive",
    documentos: [
      {
        role: "archive-page",
        url: "https://vestibular.fatec.sp.gov.br/provas-gabaritos/",
      },
    ],
  },
  {
    providerId: "unesp",
    sourceId: "unesp-vunesp-reference",
    documentos: [
      {
        role: "archive-page",
        url: "https://www.vunesp.com.br/VNSP2504",
        informational: true,
      },
    ],
  },
  {
    providerId: "unioeste",
    sourceId: "unioeste-official-archive",
    documentos: [
      {
        role: "archive-page",
        url: "https://www.unioeste.br/portal/vestibular/anteriores/82161-cadernos-de-prova",
      },
    ],
  },
];

function parseArgs(argv) {
  const args = { provider: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--provider") args.provider = argv[++index] ?? null;
    else if (argv[index] === "--json") args.json = true;
  }
  return args;
}

async function tentar(url, method = "HEAD") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method, redirect: "follow", signal: controller.signal });
    return { ok: response.ok, status: response.status, finalUrl: response.url };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: null,
      error: error?.name === "AbortError" ? "timeout" : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checar(documento) {
  let result = await tentar(documento.url, documento.method ?? "HEAD");
  // Alguns arquivos acadêmicos não implementam HEAD corretamente. Uma
  // segunda leitura GET confirma disponibilidade sem inferir conteúdo.
  if (!result.ok && result.status !== 403) result = await tentar(documento.url, "GET");
  const accepted = result.ok || (documento.informational && result.status === 403);
  return { ...result, accepted };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fontes = args.provider ? FONTES.filter((source) => source.providerId === args.provider) : FONTES;
  if (args.provider && !fontes.length) return;

  const resultados = [];
  let problemas = 0;
  for (const fonte of fontes) {
    for (const documento of fonte.documentos) {
      const result = await checar(documento);
      if (!result.accepted) problemas += 1;
      resultados.push({
        provider: fonte.providerId,
        source: fonte.sourceId,
        role: documento.role,
        url: documento.url,
        status: result.status,
        ok: result.accepted,
        finalUrl: result.finalUrl,
        error: result.error ?? null,
      });
    }
  }

  if (args.json) console.log(JSON.stringify({ resultados }, null, 2));
  else {
    for (const result of resultados) {
      console.log(`${result.ok ? "ok" : "FALHA"} ${String(result.status).padStart(3)} ${result.provider}/${result.role}`);
      console.log(`      ${result.url}`);
      if (result.error) console.log(`      erro: ${result.error}`);
    }
  }
  process.exitCode = problemas ? 1 : 0;
}

await main();
