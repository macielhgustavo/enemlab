import type { AISemanticHighlight, AISemanticHighlightRole } from "./types";

const HIGHLIGHT_PREFIX = "student-ai-";
const STYLE_ATTRIBUTE = "data-student-ai-highlight-rules";
const ROLES: AISemanticHighlightRole[] = [
  "objective",
  "condition",
  "data",
  "concept",
  "trap",
  "signal",
];

const HIGHLIGHT_RULES = `
::highlight(student-ai-objective) {
  background-color: color-mix(in srgb, var(--brand) 26%, transparent);
}
::highlight(student-ai-condition) {
  background-color: color-mix(in srgb, var(--warn) 22%, transparent);
}
::highlight(student-ai-data) {
  background-color: color-mix(in srgb, var(--cyan) 20%, transparent);
}
::highlight(student-ai-concept) {
  background-color: color-mix(in srgb, var(--violet) 19%, transparent);
}
::highlight(student-ai-trap) {
  background-color: color-mix(in srgb, var(--bad) 18%, transparent);
}
::highlight(student-ai-signal) {
  background-color: color-mix(in srgb, var(--text-dim) 16%, transparent);
}
`;

type HighlightRegistryLike = {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
};

type HighlightConstructorLike = new (...ranges: Range[]) => unknown;

type HighlightAPI = {
  CSS?: { highlights?: HighlightRegistryLike };
  Highlight?: HighlightConstructorLike;
};

type DomPoint = {
  node: Text;
  offset: number;
};

function normalizeQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function normalizedTextMap(root: HTMLElement): { text: string; points: DomPoint[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const points: DomPoint[] = [];
  let text = "";
  let pendingSpace: DomPoint | null = null;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue || "";

    for (let offset = 0; offset < value.length; offset += 1) {
      const char = value[offset];
      if (/\s/.test(char)) {
        if (text && !text.endsWith(" ")) pendingSpace = { node, offset };
        continue;
      }

      if (pendingSpace && text && !text.endsWith(" ")) {
        text += " ";
        points.push(pendingSpace);
      }
      pendingSpace = null;

      text += char.toLocaleLowerCase("pt-BR");
      points.push({ node, offset });
    }
  }

  return { text, points };
}

function rangeForQuote(root: HTMLElement, quote: string): Range | null {
  const normalizedQuote = normalizeQuote(quote);
  if (normalizedQuote.length < 4) return null;

  const mapped = normalizedTextMap(root);
  const start = mapped.text.indexOf(normalizedQuote);
  if (start < 0) return null;

  const first = mapped.points[start];
  const last = mapped.points[start + normalizedQuote.length - 1];
  if (!first || !last) return null;

  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, Math.min(last.offset + 1, last.node.length));
  return range;
}

function registryApi(): {
  registry: HighlightRegistryLike;
  HighlightCtor: HighlightConstructorLike;
} | null {
  const api = globalThis as unknown as HighlightAPI;
  const registry = api.CSS?.highlights;
  const HighlightCtor = api.Highlight;
  if (!registry || !HighlightCtor) return null;
  return { registry, HighlightCtor };
}

function ensureHighlightStyles(): void {
  if (document.head.querySelector(`style[${STYLE_ATTRIBUTE}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTRIBUTE, "");
  style.textContent = HIGHLIGHT_RULES;
  document.head.appendChild(style);
}

/**
 * Aplica CSS Custom Highlights sem alterar o DOM gerenciado pelo React.
 * Navegadores sem a API simplesmente mantêm a resposta textual da IA.
 */
export function applySemanticHighlights(highlights: AISemanticHighlight[]): () => void {
  if (typeof document === "undefined") return () => undefined;
  const api = registryApi();
  if (!api) return () => undefined;

  ensureHighlightStyles();

  const roots = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".examContent #questionContent .context, .examContent #questionContent .intro",
    ),
  );
  if (!roots.length) return () => undefined;

  const byRole = new Map<AISemanticHighlightRole, Range[]>();

  for (const highlight of highlights) {
    for (const root of roots) {
      const range = rangeForQuote(root, highlight.text);
      if (!range) continue;
      const ranges = byRole.get(highlight.role) || [];
      ranges.push(range);
      byRole.set(highlight.role, ranges);
      break;
    }
  }

  for (const role of ROLES) {
    api.registry.delete(`${HIGHLIGHT_PREFIX}${role}`);
    const ranges = byRole.get(role);
    if (ranges?.length) {
      api.registry.set(`${HIGHLIGHT_PREFIX}${role}`, new api.HighlightCtor(...ranges));
    }
  }

  return () => {
    for (const role of ROLES) api.registry.delete(`${HIGHLIGHT_PREFIX}${role}`);
  };
}
