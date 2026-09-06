#!/usr/bin/env node
// Saúde das fontes (§33).
//
//   npm run sources:audit
//   npm run sources:audit -- --provider ita
//
// Responde uma pergunta: **os documentos que declaramos ainda estão lá?**
//
// Bancas reorganizam o site, tiram edição do ar e publicam retificação sem
// avisar. Sem esta varredura, a primeira notícia de que um link morreu é um
// aluno clicando em "abrir prova oficial" e caindo num 404.
//
// Isto **usa rede** de propósito e por isso não roda no `npm test` (§45):
// teste unitário que depende do servidor de outra pessoa falha quando o
// problema não é do nosso código, e vermelho que não é culpa nossa ensina a
// ignorar o vermelho.

const TIMEOUT_MS = 20_000;

function parseArgs(argv) {
  const args = { provider: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider") args.provider = argv[++i] ?? null;
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

/**
 * Fontes declaradas.
 *
 * Escrito aqui em vez de importado do TypeScript porque este script roda em
 * Node puro, sem passo de build. A duplicação é pequena e o teste
 * `sources-audit.test.ts` reprova se as duas listas divergirem.
 */
const FONTES = [
  {
    providerId: "enem",
    sourceId: "enem-dev",
    archiveUrl: "https://api.enem.dev",
    documentos: [{ role: "structured-api", url: "https://api.enem.dev/v1/exams" }],
  },
  {
    providerId: "ita",
    sourceId: "ita-official-archive",
    archiveUrl: "https://www.vestibular.ita.br/provas.htm",
    documentos: [
      { role: "objective-exam", url: "https://www.vestibular.ita.br/provas/2026_fase1.pdf" },
      { role: "objective-exam", url: "https://www.vestibular.ita.br/provas/2019_fase1.pdf" },
      { role: "subject-exam", url: "https://www.vestibular.ita.br/provas/matematica_2026_2f.pdf" },
      // Conferido em 2026-09: Português da 2ª fase só existe de 2025 em
      // diante. Este 404 esperado é o caso de teste do próprio audit.
      { url: "https://www.vestibular.ita.br/provas/portugues_2024_2f.pdf", role: "subject-exam", esperado404: true },
    ],
  },
];

async function checar(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal, redirect: "follow" });
    return {
      status: res.status,
      ok: res.ok,
      contentLength: Number(res.headers.get("content-length")) || null,
      lastModified: res.headers.get("last-modified"),
      etag: res.headers.get("etag"),
      redirected: res.redirected,
      finalUrl: res.url,
    };
  } catch (e) {
    return { status: 0, ok: false, erro: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fontes = args.provider
    ? FONTES.filter((f) => f.providerId === args.provider)
    : FONTES;

  if (!fontes.length) {
    console.error(`fonte desconhecida: ${args.provider}`);
    process.exit(1);
  }

  const resultados = [];
  let problemas = 0;

  for (const f of fontes) {
    for (const d of f.documentos) {
      const r = await checar(d.url);
      // Um 404 previsto não é problema: é conhecimento sobre o arquivo. O
      // que assusta é ele **deixar** de dar 404 — significa que a banca
      // publicou algo que ainda não foi ingerido.
      const esperado = d.esperado404 === true;
      const okEsperado = esperado ? r.status === 404 : r.ok;
      if (!okEsperado) problemas++;

      resultados.push({
        provider: f.providerId,
        source: f.sourceId,
        role: d.role,
        url: d.url,
        status: r.status,
        esperado404: esperado,
        ok: okEsperado,
        redirected: r.redirected ?? false,
        contentLength: r.contentLength ?? null,
        lastModified: r.lastModified ?? null,
        etag: r.etag ?? null,
        erro: r.erro ?? null,
      });
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ verificadoEm: new Date().toISOString(), resultados }, null, 2));
  } else {
    for (const r of resultados) {
      const marca = r.ok ? "ok  " : "FALHA";
      const nota = r.esperado404 ? " (404 esperado)" : r.redirected ? " (redirecionado)" : "";
      console.log(`${marca} ${String(r.status).padStart(3)} ${r.provider}/${r.role}${nota}`);
      console.log(`      ${r.url}`);
      if (r.erro) console.log(`      erro: ${r.erro}`);
    }
    console.log(`\n${resultados.length} documento(s), ${problemas} problema(s).`);
  }

  process.exit(problemas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
