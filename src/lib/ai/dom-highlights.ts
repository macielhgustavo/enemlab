import type { AISemanticHighlight, AISemanticHighlightRole } from "./types";

const HIGHLIGHT_PREFIX = "student-ai-";
const ROLES: AISemanticHighlightRole[] = [
  "objective",
  "condition",
  "data",
  "concept",
  "trap",
  "signal",
];

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

/**
 * Aplica CSS Custom Highlights sem alterar o DOM gerenciado pelo React.
 * Navegadores sem a API simplesmente mantêm a resposta textual da IA.
 */
export function applySemanticHighlights(highlights: AISemanticHighlight[]): () => void {
  const api = registryApi();
  if (!api || typeof document === "undefined") return () => undefined;

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
