// Utilitários de formatação e texto (portados do v6).

export function uid(): string {
  return "a_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

export function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 100) : 0;
}

export function esc(x: unknown): string {
  return String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c] as string,
  );
}

export function fmtSec(s: number): string {
  s = Math.max(0, Math.floor(s || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}

export function shortSec(s: number): string {
  s = Math.max(0, Math.round(s || 0));
  return s < 60
    ? s + "s"
    : Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
}

const CP1252_REVERSE = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function mojibakeScore(value: string): number {
  return (value.match(/Ã|Â|â€|â€™|â€œ|â€|â€“|â€”|ï»¿|�/g) || []).length;
}

function decodeUtf8Mojibake(value: string): string | null {
  const bytes: number[] = [];
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) {
      bytes.push(cp);
      continue;
    }
    const mapped = CP1252_REVERSE.get(cp);
    if (mapped === undefined) return null;
    bytes.push(mapped);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  deg: "°",
  times: "×",
  divide: "÷",
  plusmn: "±",
  le: "≤",
  ge: "≥",
  ne: "≠",
  micro: "µ",
  middot: "·",
};

function decodeKnownEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (all, n) => {
      const cp = Number(n);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    })
    .replace(/&#x([0-9a-f]+);/gi, (all, n) => {
      const cp = Number.parseInt(n, 16);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|deg|times|divide|plusmn|le|ge|ne|micro|middot);/gi, (all, name) => ENTITY_MAP[String(name).toLowerCase()] ?? all);
}

/**
 * Repara apenas problemas de apresentação comuns no banco: mojibake
 * UTF-8/Windows-1252, entidades HTML simples, BOM e caracteres invisíveis.
 * Não corrige ortografia nem altera o conteúdo semântico da questão.
 */
export function repairQuestionText(x: unknown): string {
  let text = String(x ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B\u200C\u200D\u2060]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n");

  for (let i = 0; i < 2 && mojibakeScore(text) > 0; i++) {
    const decoded = decodeUtf8Mojibake(text);
    if (!decoded || mojibakeScore(decoded) >= mojibakeScore(text)) break;
    text = decoded;
  }

  return decodeKnownEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{3,}/g, "  ")
    .normalize("NFC");
}

export function normalizeText(x: unknown): string {
  return repairQuestionText(x)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function safeUrl(raw: unknown): string {
  try {
    const u = new URL(String(raw || "").trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

export function markdownImageUrls(x: unknown): string[] {
  const out: string[] = [];
  const raw = repairQuestionText(x);
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const u = safeUrl(m[2]);
    if (u) out.push(u);
  }
  return out;
}

function protectInlineHtml(raw: string, token: (html: string) => string): string {
  raw = raw.replace(/<br\s*\/?\s*>/gi, "\n");
  for (const [tag, htmlTag] of [
    ["sup", "sup"],
    ["sub", "sub"],
    ["strong", "strong"],
    ["b", "strong"],
    ["em", "em"],
    ["i", "em"],
  ] as const) {
    const re = new RegExp(`<${tag}\\s*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi");
    raw = raw.replace(re, (_all, inner) => token(`<${htmlTag}>${esc(repairQuestionText(inner))}</${htmlTag}>`));
  }
  return raw;
}

function protectMath(raw: string, token: (html: string) => string): string {
  for (const re of [
    /\$\$[\s\S]+?\$\$/g,
    /\\\[[\s\S]+?\\\]/g,
    /\\\([\s\S]+?\\\)/g,
    /\$(?!\s)([^$\n]+?)\$/g,
  ]) {
    raw = raw.replace(re, (m) => token(`<span class="mathSource">${esc(m)}</span>`));
  }
  return raw;
}

// Converte o markdown enxuto do banco em HTML seguro. Também preserva
// marcação matemática e um subconjunto mínimo de HTML comum em provas.
export function richText(x: unknown): string {
  let raw = repairQuestionText(x);
  const tokens: string[] = [];
  const token = (html: string) => {
    const idx = `@@ENEMTOK${tokens.length}@@`;
    tokens.push(html);
    return idx;
  };

  raw = protectInlineHtml(raw, token);
  raw = protectMath(raw, token);

  raw = raw.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi, (all, alt, url) => {
    const u = safeUrl(url);
    if (!u) return all;
    return token(
      `<span class="embeddedMedia"><img class="questionMedia" data-zoomable="true" src="${esc(u)}" alt="${esc(repairQuestionText(alt) || "Imagem da questão")}" loading="eager" decoding="async"></span>`,
    );
  });

  raw = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, (all, label, url) => {
    const u = safeUrl(url);
    if (!u) return all;
    let shown = repairQuestionText(label).trim();
    if (/^https?:\/\//i.test(shown)) {
      try {
        shown = new URL(u).hostname.replace(/^www\./, "");
      } catch {
        /* noop */
      }
    }
    return token(
      `<a class="qLink" href="${esc(u)}" target="_blank" rel="noopener">${esc(shown || "fonte")} ↗</a>`,
    );
  });

  let t = esc(raw);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__(.+?)__/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  const paras = t
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  t = paras.length > 1
    ? paras.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")
    : t.replace(/\n/g, "<br>");

  tokens.forEach((html, i) => {
    t = t.replaceAll(`@@ENEMTOK${i}@@`, html);
  });
  return t;
}
