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

export function normalizeText(x: unknown): string {
  return String(x || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
  const raw = String(x || "");
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const u = safeUrl(m[2]);
    if (u) out.push(u);
  }
  return out;
}

// Converte o markdown enxuto do banco (imagens, links, negrito, itálico,
// parágrafos) em HTML seguro. Retorna string para dangerouslySetInnerHTML.
export function richText(x: unknown): string {
  let raw = String(x || "").replace(/\r\n?/g, "\n");
  const tokens: string[] = [];
  const token = (html: string) => {
    const idx = `@@ENEMTOK${tokens.length}@@`;
    tokens.push(html);
    return idx;
  };

  raw = raw.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi, (all, alt, url) => {
    const u = safeUrl(url);
    if (!u) return all;
    return token(
      `<span class="embeddedMedia"><img src="${esc(u)}" alt="${esc(
        alt || "Imagem da questão",
      )}" loading="eager"></span>`,
    );
  });

  raw = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, (all, label, url) => {
    const u = safeUrl(url);
    if (!u) return all;
    let shown = String(label || "").trim();
    if (/^https?:\/\//i.test(shown)) {
      try {
        shown = new URL(u).hostname.replace(/^www\./, "");
      } catch {
        /* noop */
      }
    }
    return token(
      `<a class="qLink" href="${esc(u)}" target="_blank" rel="noopener">${esc(
        shown || "fonte",
      )} ↗</a>`,
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
  t =
    paras.length > 1
      ? paras.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")
      : t.replace(/\n/g, "<br>");

  tokens.forEach((html, i) => {
    t = t.replaceAll(`@@ENEMTOK${i}@@`, html);
  });
  return t;
}
