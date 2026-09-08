import { createHash } from "node:crypto";

export function isRecordedArchive(originalUrl, archiveUrl) {
  const prefix = /^https:\/\/web\.archive\.org\/web\/\d{14}id_\//;
  return prefix.test(archiveUrl) && archiveUrl.replace(prefix, "") === originalUrl;
}

export function discoverFabEditions(text, provider) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || !Array.isArray(rows[0]) || !rows[0].includes("original")) {
    throw new Error("índice CDX inválido");
  }
  const column = rows[0].indexOf("original");
  const prefix = provider === "afa" ? "afa" : "cpcar";
  const editions = new Set();
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row) || typeof row[column] !== "string") throw new Error("linha CDX inválida");
    const url = new URL(row[column]);
    if (!["fab.mil.br", "www.fab.mil.br"].includes(url.hostname)) continue;
    const name = url.pathname.split("/").pop().toLowerCase();
    const match = name.match(new RegExp(`^${prefix}[_-]?(\\d{4})`));
    if (!match || !name.endsWith(".pdf") || !/gab|oficial/.test(name)) continue;
    if (/provisorio|_prov|provis|resultado|convoc|tacf|inspsau|_cf_|locais/.test(name)) continue;
    editions.add(Number(match[1]));
  }
  return [...editions].sort((first, second) => first - second);
}

export async function inspectPdf(url, expected, fetcher = fetch) {
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(45_000), redirect: "follow",
    });
    const result = { status: response.status, finalUrl: response.url || url, healthy: false };
    if (!response.ok) return { ...result, error: `HTTP ${response.status}` };
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const complete = bytes.subarray(0, 5).toString() === "%PDF-" &&
      bytes.subarray(-1024).toString().trimEnd().endsWith("%%EOF");
    const matches = (!expected.sha256 || sha256 === expected.sha256) &&
      (!expected.bytes || bytes.length === expected.bytes);
    return {
      ...result, sha256, bytes: bytes.length, healthy: complete && matches,
      error: !complete ? "resposta não é PDF íntegro" : !matches ? "checksum/tamanho alterado" : null,
    };
  } catch (error) {
    return { status: 0, healthy: false, error: error.message };
  }
}

export async function auditArchivedDocument(document, fetcher = fetch) {
  const recorded = isRecordedArchive(document.url, document.archiveUrl ?? "");
  const [origin, archive] = await Promise.all([
    inspectPdf(document.url, document, fetcher),
    recorded ? inspectPdf(document.archiveUrl, document, fetcher) :
      Promise.resolve({ status: 0, healthy: false, error: "snapshot não corresponde à URL oficial" }),
  ]);
  if (archive.healthy && !isRecordedArchive(document.url, archive.finalUrl)) {
    archive.healthy = false;
    archive.error = "snapshot redirecionado para documento diferente";
  }
  return {
    origin: { ...origin, state: origin.status === 403 && recorded ? "blocked-expected" :
      origin.healthy ? "healthy" : "broken" },
    archive: { ...archive, state: archive.healthy ? "healthy" : "broken" },
    ok: recorded && archive.healthy,
  };
}
