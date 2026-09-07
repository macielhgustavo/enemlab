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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { auditArchivedDocument, discoverFabEditions } from "./fab-source-audit.mjs";

const TIMEOUT_MS = 20_000;

function parseArgs(argv) {
  const args = { provider: null, json: false, baseline: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--provider") args.provider = argv[++i] ?? null;
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--baseline") args.baseline = argv[++i] ?? null;
    else if (argv[i] === "--output") args.output = argv[++i] ?? null;
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
  // As duas fontes da FAB são o caso `viaArquivo`: a instituição publica os
  // documentos mas responde 403 a qualquer cliente automatizado, então a
  // ingestão lê a cópia datada no Internet Archive. O audit acompanha isso
  // como é, em vez de reportar quebra a cada rodada — vermelho permanente
  // que não é culpa nossa ensina a ignorar o vermelho.
  {
    providerId: "afa",
    sourceId: "afa-official-archive",
    archiveUrl: "https://www.fab.mil.br/ingresso/provas.html",
    viaArquivo: true,
    documentos: [
      // Informativa: é a página que um humano abre, não a que a descoberta
      // lê. Quem descobre edição é a linha `discovery`, contra o índice do
      // arquivo. Registrada para não sumir do manifesto, sem reprovar.
      { role: "archive-page", url: "https://www.fab.mil.br/ingresso/provas.html", informativo: true },
      {
        role: "answer-key",
        url: "https://www.fab.mil.br/ingresso/arquivos/2024/afa/afa2025_gab_oficial.pdf",
      },
      {
        role: "answer-key",
        url: "https://www.fab.mil.br/ingresso/arquivos/2023/afa2024_gabarito_oficial.pdf",
      },
      {
        role: "answer-key",
        url: "https://www.fab.mil.br/ingresso/arquivos/provas/afa2019_gab_oficial.pdf",
      },
    ],
    knownEditions: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    // Casa só gabarito **oficial**: `afa2021_aviso_tacf` e
    // `afa2024_resultado_inspsau_gabrielle` casam com "gab" sem ser gabarito,
    // e provisório nunca termina em "oficial".
    editionPattern: /afa(20\d{2})[-_](?:[a-z0-9]+[-_])?gab(?:arito)?[-_]oficial/gi,
    requiredRoles: ["archive-page", "answer-key"],
  },
  {
    providerId: "epcar",
    sourceId: "epcar-official-archive",
    archiveUrl: "https://www.fab.mil.br/ingresso/provas.html",
    viaArquivo: true,
    documentos: [
      { role: "archive-page", url: "https://www.fab.mil.br/ingresso/provas.html", informativo: true },
      {
        role: "answer-key",
        url: "https://www.fab.mil.br/ingresso/arquivos/2024/cpcar/cpcar2025_gab_oficial.pdf",
      },
      {
        role: "answer-key",
        url: "https://www.fab.mil.br/ingresso/arquivos/2022/cpcar/cpcar2023_oficial.pdf",
      },
      {
        role: "answer-key",
        url: "https://www.fab.mil.br/ingresso/arquivos/provas/cpcar2020_gab_oficial.pdf",
      },
    ],
    knownEditions: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    // 2023 é `cpcar2023_oficial.pdf`, sem "gab" no nome — por isso o grupo
    // do gabarito é opcional aqui.
    editionPattern: /cpcar[-_]?(20\d{2})[-_](?:[a-z0-9]+[-_])?(?:gab(?:arito)?[-_])?oficial/gi,
    requiredRoles: ["archive-page", "answer-key"],
  },
  {
    providerId: "ufpr",
    sourceId: "ufpr-research",
    archiveUrl: "https://lua.nc.ufpr.br/PortalNC/Concurso?concurso=PS2026",
    documentos: [
      { role: "archive-page", url: "https://lua.nc.ufpr.br/PortalNC/Concurso?concurso=PS2026" },
      {
        role: "notice",
        url: "https://servicos.nc.ufpr.br/documentos/ps2026/provas/definitivo/relatorio-anuladas-alteradas.pdf",
      },
    ],
  },
  {
    providerId: "eear",
    sourceId: "eear-research",
    archiveUrl: "https://ingresso.eear.fab.mil.br/SOO/home/provas_anteriores.php?sigla_conc=%25",
    documentos: [
      {
        role: "archive-page",
        url: "https://ingresso.eear.fab.mil.br/SOO/home/provas_anteriores.php?sigla_conc=%25",
      },
    ],
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
  {
    providerId: "ime",
    sourceId: "ime-cfg-archive",
    archiveUrl:
      "https://www.ime.eb.mil.br/vestibular-e-concursos/cfg-ensino-medio/provas-anteriores-cfg",
    documentos: [
      // A página de arquivo é o que a descoberta lê. Se ela mudar de
      // endereço, o importador para de achar edição — e é isso que este
      // audit precisa avisar antes de alguém notar pela ausência.
      {
        role: "archive-page",
        url: "https://www.ime.eb.mil.br/vestibular-e-concursos/cfg-ensino-medio/provas-anteriores-cfg",
      },
      {
        role: "answer-key",
        url: "https://www.ime.eb.mil.br/images/arquivos/admissao/cfg/provas-anteriores/2025-2026/Gabarito_FINAL_2025-2026OBJETIVA.pdf",
      },
      {
        role: "objective-exam",
        url: "https://www.ime.eb.mil.br/images/arquivos/admissao/cfg/provas-anteriores/2025-2026/Prova1fase2025OBJETIVA.pdf",
      },
      {
        role: "answer-key",
        url: "https://www.ime.eb.mil.br/images/arquivos/admissao/cfg/provas-anteriores/2018-2019/CFG_Gabarito_Objetiva_2018_2019.pdf",
      },
    ],
  },
  {
    providerId: "enem",
    sourceId: "inep-official-archive",
    archiveUrl:
      "https://www.gov.br/inep/pt-br/areas-de-atuacao/avaliacao-e-exames-educacionais/enem/provas-e-gabaritos",
    documentos: [
      // Registrada e ainda não ingerida. O audit acompanha os documentos que
      // uma futura importação vai usar, para a wave seguinte não descobrir
      // link morto só na hora de escrever o parser.
      {
        role: "answer-key",
        url: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_GB_impresso_D1_CD1.pdf",
      },
      {
        role: "answer-key",
        url: "https://download.inep.gov.br/enem/provas_e_gabaritos/2024_GB_impresso_D1_CD1.pdf",
      },
      {
        role: "objective-exam",
        url: "https://download.inep.gov.br/enem/provas_e_gabaritos/2024_PV_impresso_D1_CD1.pdf",
      },
    ],
  },
  {
    providerId: "fuvest",
    sourceId: "fuvest-archive",
    archiveUrl: "https://www.fuvest.br/acervo-vestibular",
    documentos: [
      { role: "archive-page", url: "https://www.fuvest.br/acervo-vestibular" },
      {
        role: "answer-key",
        url: "https://www.fuvest.br/wp-content/uploads/fuvest2025_gabarito_primeira_fase.pdf",
      },
      {
        role: "objective-exam",
        url: "https://www.fuvest.br/wp-content/uploads/fuvest2025_primeira_fase_prova_V1.pdf",
      },
    ],
  },
];

for (const fonte of FONTES.filter((entry) => entry.viaArquivo)) {
  const dataset = JSON.parse(readFileSync(new URL(
    `../src/lib/providers/${fonte.providerId}/answer-keys.generated.json`, import.meta.url,
  ), "utf8"));
  fonte.documentos = [fonte.documentos[0], ...Object.values(dataset).map((entry) => ({
    role: "answer-key", year: entry.year, url: entry.answerKeyUrl,
    archiveUrl: entry.retrieval.retrievedFrom,
    sha256: entry.retrieval.sha256, bytes: entry.retrieval.bytes,
  }))];
}

/**
 * Confere um documento, com uma segunda tentativa.
 *
 * Falha de rede transitória acontece — numa execução, um gabarito do INEP
 * deu "fetch failed" e respondeu 200 no retry segundos depois. Sem a
 * segunda tentativa, o audit produz alarme falso, e alarme falso ensina a
 * ignorar o vermelho. Uma tentativa extra basta: erro que persiste nas duas
 * é notícia de verdade.
 */
async function checar(url) {
  const primeira = await tentar(url);
  if (primeira.ok || primeira.status === 404) return primeira;
  await new Promise((r) => setTimeout(r, 1500));
  const segunda = await tentar(url);
  return segunda.ok || segunda.status === 404
    ? segunda
    : { ...segunda, erro: `${segunda.erro ?? segunda.status} (falhou em duas tentativas)` };
}

async function tentar(url) {
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

/**
 * Existe cópia datada deste documento no arquivo público?
 *
 * Para as fontes `viaArquivo`, é **esta** a pergunta que importa: a URL viva
 * responde 403 por desenho, e o que a ingestão de fato lê é a cópia. Um 403
 * na FAB é rotina; a cópia sumir é que quebraria a reimportação.
 */
async function tentarTexto(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "enemlab-sources-audit/1.0" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    return { status: res.status, ok: res.ok, text: res.ok ? await res.text() : "" };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      text: "",
      erro: e.name === "AbortError" ? "timeout" : e.message,
    };
  } finally {
    clearTimeout(t);
  }
}

function carregarBaseline(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error("baseline ilegível: " + e.message);
    process.exit(1);
  }
}

function documentoMudou(previous, current) {
  if (!previous) return false;
  if (previous.finalUrl && current.finalUrl && previous.finalUrl !== current.finalUrl) return true;
  if (previous.etag && current.etag && previous.etag !== current.etag) return true;
  return (
    previous.contentLength !== null &&
    current.contentLength !== null &&
    previous.contentLength !== current.contentLength
  );
}

/** Índice do arquivo público — a mesma varredura que `ingest-fab.py` usa. */
function urlsDescobertaArquivo() {
  return ["fab.mil.br/ingresso/arquivos*", "fab.mil.br/ingresso*"].map((pattern) =>
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pattern)}` +
    "&output=json&filter=statuscode:200&collapse=urlkey&limit=30000",
  );
}

async function auditarNovasEdicoes(fonte) {
  if (!fonte.editionPattern || !fonte.knownEditions) return null;
  // Numa fonte lida pelo arquivo, raspar a página da instituição só devolve
  // o 403. A descoberta precisa olhar onde a ingestão olha.
  const alvos = fonte.viaArquivo ? urlsDescobertaArquivo() : [fonte.archiveUrl];
  const responses = await Promise.all(alvos.map(async (url) => {
    if (!discoveryCache.has(url)) discoveryCache.set(url, tentarTexto(url));
    return discoveryCache.get(url);
  }));
  const response = responses.find((item) => !item.ok) ?? {
    ok: true, status: 200, text: responses.map((item) => item.text).join("\n"),
  };
  if (!response.ok) {
    return {
      status: response.status,
      novas: [],
      ok: false,
      erro: response.erro ?? "arquivo respondeu " + response.status + "; descoberta não verificável",
      urls: alvos,
    };
  }

  let encontrados;
  try {
    encontrados = responses.flatMap((item) => discoverFabEditions(item.text, fonte.providerId));
    if (!encontrados.length) throw new Error("índice não retornou edições reconhecíveis");
  } catch (error) {
    return { status: response.status, novas: [], ok: false, erro: error.message, urls: alvos };
  }
  const novas = [...new Set(encontrados)].filter((year) => !fonte.knownEditions.includes(year));
  return { status: response.status, novas, encontradas: [...new Set(encontrados)].sort(), ok: true, erro: null, urls: alvos };
}

const discoveryCache = new Map();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseline = carregarBaseline(args.baseline);
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
      if (f.viaArquivo && !d.informativo) {
        const audit = await auditArchivedDocument(d);
        if (!audit.ok) problemas++;
        resultados.push({ provider: f.providerId, source: f.sourceId, role: d.role,
          year: d.year, url: d.url, archiveUrl: d.archiveUrl,
          status: audit.origin.status, ...audit,
          erro: audit.ok ? null : audit.archive.error,
        });
        continue;
      }
      const r = await checar(d.url);
      const anterior = baseline?.resultados?.find((item) => item.url === d.url);
      const mudou = documentoMudou(anterior, r);
      // Um 404 previsto não é problema: é conhecimento sobre o arquivo. O
      // que assusta é ele **deixar** de dar 404 — significa que a banca
      // publicou algo que ainda não foi ingerido.
      const esperado = d.esperado404 === true;

      // Fonte lida pelo arquivo: o que reprova é a cópia sumir, não a
      // instituição recusar o cliente automatizado.
      const okEsperado = d.informativo
        ? r.ok || r.status === 403
        : esperado
          ? r.status === 404
          : r.ok && !mudou;
      if (!okEsperado) problemas++;

      resultados.push({
        provider: f.providerId,
        source: f.sourceId,
        role: d.role,
        url: d.url,
        status: r.status,
        finalUrl: r.finalUrl ?? null,
        changed: mudou,
        esperado404: esperado,
        informational: d.informativo ?? false,
        originState: d.informativo && r.status === 403 ? "blocked-expected" : undefined,
        ok: d.informativo && r.status === 403 ? null : okEsperado,
        redirected: r.redirected ?? false,
        contentLength: r.contentLength ?? null,
        lastModified: r.lastModified ?? null,
        etag: r.etag ?? null,
        erro: r.erro ?? null,
      });
    }

    for (const role of f.requiredRoles ?? []) {
      if (f.documentos.some((documento) => documento.role === role)) continue;
      problemas++;
      resultados.push({
        provider: f.providerId,
        source: f.sourceId,
        role: "manifest",
        url: f.archiveUrl,
        status: 0,
        esperado404: false,
        ok: false,
        redirected: false,
        changed: false,
        novasEdicoes: [],
        contentLength: null,
        lastModified: null,
        etag: null,
        erro: "documento obrigatório ausente no manifesto: " + role,
      });
    }

    const discovery = await auditarNovasEdicoes(f);
    if (discovery) {
      const hasNewEditions = discovery.novas.length > 0;
      if (hasNewEditions || !discovery.ok) problemas++;
      resultados.push({
        provider: f.providerId,
        source: f.sourceId,
        role: "discovery",
        url: discovery.urls[0],
        discoveryUrls: discovery.urls,
        status: discovery.status,
        esperado404: false,
        ok: !hasNewEditions && discovery.ok,
        redirected: false,
        changed: false,
        novasEdicoes: discovery.novas,
        discoveredEditions: discovery.encontradas ?? [],
        contentLength: null,
        lastModified: null,
        etag: null,
        erro: discovery.erro ?? null,
      });
    }
  }

  const report = JSON.stringify({ verificadoEm: new Date().toISOString(), resultados }, null, 2);
  if (args.output) writeFileSync(args.output, report + "\n");
  if (args.json) {
    console.log(report);
  } else {
    for (const r of resultados) {
      const marca = r.ok === null ? "INFO " : r.ok ? "ok  " : "FALHA";
      const nota = r.esperado404
        ? " (404 esperado)"
        : r.changed
          ? " (documento alterado)"
          : r.novasEdicoes?.length
            ? " (nova(s): " + r.novasEdicoes.join(", ") + ")"
            : r.redirected
              ? " (redirecionado)"
              : "";
      console.log(`${marca} ${String(r.status).padStart(3)} ${r.provider}/${r.role}${nota}`);
      console.log(`      ${r.url}`);
      if (r.archive) console.log(`      origin=${r.origin.state}; archive=${r.archive.state}: ${r.archiveUrl}`);
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
