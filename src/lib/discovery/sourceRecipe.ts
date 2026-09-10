import type {
  DiscoveredDocument,
  DiscoveredEdition,
  DocumentFetcher,
  DocumentRole,
} from "../sources/ingestion";

export interface SourceLinkCandidate {
  url: string;
  text: string;
  /** Page that exposed this link. Useful when the document URL itself has no year. */
  sourcePageUrl: string;
}

export interface SourceRecipeDocumentRule {
  /**
   * A single official file may legitimately play more than one role. For
   * example, some institutions publish a final exam booklet with the correct
   * alternatives marked inside the same PDF.
   */
  role: DocumentRole | DocumentRole[];
  /** Matcher against anchor text, target URL and source page URL. */
  match: RegExp;
  phase?: string;
  subject?: string;
  variant?: string;
}

export interface SourceRecipeEditionRule {
  /** Extracts the edition year from candidate/source-page context in capture group 1. */
  year: RegExp;
  /** Optional stable edition id override. Defaults to the four-digit year. */
  editionId?: (candidate: SourceLinkCandidate, year: number) => string;
  label?: (candidate: SourceLinkCandidate, year: number) => string;
}

export interface SourceRecipeCrawlRule {
  /** Number of link hops after an archive seed. 0 keeps the old one-page behavior. */
  maxDepth: number;
  /** Hard cap across all seed and child page fetch attempts. */
  maxPages?: number;
  /** Only links matching one of these patterns may become crawl pages. */
  follow: RegExp[];
  /** Extra deterministic guard for institution-specific page layouts. */
  acceptPage?: (candidate: SourceLinkCandidate, nextDepth: number) => boolean;
}

export interface OfficialSourceRecipe {
  sourceId: string;
  institution: string;
  archiveUrls: string[];
  allowedHosts: string[];
  edition: SourceRecipeEditionRule;
  documents: SourceRecipeDocumentRule[];
  minYear?: number;
  maxYear?: number;
  /** Optional filter applied only after a link already matched a document role. */
  acceptCandidate?: (candidate: SourceLinkCandidate) => boolean;
  /** Optional bounded crawl for archives that link to one page per edition. */
  crawl?: SourceRecipeCrawlRule;
}

export interface HarvestIssue {
  /** Historical field name kept for compatibility; may refer to a crawled child page. */
  archiveUrl: string;
  message: string;
}

export interface HarvestResult {
  sourceId: string;
  institution: string;
  editions: DiscoveredEdition[];
  issues: HarvestIssue[];
  pagesFetched: number;
  pagesAttempted: number;
  linksSeen: number;
  matchedDocuments: number;
}

interface CrawlQueueItem {
  url: string;
  depth: number;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

export function extractHtmlLinks(html: string, baseUrl: string): SourceLinkCandidate[] {
  const links: SourceLinkCandidate[] = [];
  const anchor = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html))) {
    const href = decodeHtml(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (
      !href ||
      href.startsWith("#") ||
      /^javascript:/i.test(href) ||
      /^mailto:/i.test(href)
    ) {
      continue;
    }
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      links.push({
        url: normalizeUrl(url.toString()),
        text: stripTags(match[4] ?? ""),
        sourcePageUrl: normalizeUrl(baseUrl),
      });
    } catch {
      // Invalid links are discovery noise, not fatal source failures.
    }
  }
  return links;
}

function hostAllowed(url: string, allowedHosts: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowedHosts.some((allowed) => {
      const canonical = allowed.toLowerCase();
      return host === canonical || host.endsWith(`.${canonical}`);
    });
  } catch {
    return false;
  }
}

function matchRegex(regex: RegExp, value: string): RegExpExecArray | null {
  regex.lastIndex = 0;
  return regex.exec(value);
}

function candidateCorpus(candidate: SourceLinkCandidate): string {
  return `${candidate.text}\n${candidate.url}\n${candidate.sourcePageUrl}`;
}

function detectYear(recipe: OfficialSourceRecipe, candidate: SourceLinkCandidate): number | null {
  const matched = matchRegex(recipe.edition.year, candidateCorpus(candidate));
  if (!matched?.[1]) return null;
  const year = Number(matched[1]);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (recipe.minYear !== undefined && year < recipe.minYear) return null;
  if (recipe.maxYear !== undefined && year > recipe.maxYear) return null;
  return year;
}

function detectDocuments(
  recipe: OfficialSourceRecipe,
  candidate: SourceLinkCandidate,
): DiscoveredDocument[] {
  const corpus = candidateCorpus(candidate);
  for (const rule of recipe.documents) {
    if (!matchRegex(rule.match, corpus)) continue;
    const roles = Array.isArray(rule.role) ? rule.role : [rule.role];
    return roles.map((role) => ({
      role,
      url: candidate.url,
      phase: rule.phase,
      subject: rule.subject,
      variant: rule.variant,
    }));
  }
  return [];
}

function stableDocumentKey(document: DiscoveredDocument): string {
  return [
    document.role,
    document.phase ?? "",
    document.subject ?? "",
    document.variant ?? "",
    document.url,
  ].join("|");
}

function shouldFollow(
  recipe: OfficialSourceRecipe,
  candidate: SourceLinkCandidate,
  nextDepth: number,
): boolean {
  const crawl = recipe.crawl;
  if (!crawl || nextDepth > crawl.maxDepth) return false;
  if (!crawl.follow.length) return false;
  if (crawl.acceptPage && !crawl.acceptPage(candidate, nextDepth)) return false;
  const corpus = candidateCorpus(candidate);
  return crawl.follow.some((pattern) => Boolean(matchRegex(pattern, corpus)));
}

function validateRecipe(recipe: OfficialSourceRecipe): void {
  if (!recipe.sourceId.trim()) throw new Error("source recipe requires sourceId");
  if (!recipe.institution.trim()) throw new Error("source recipe requires institution");
  if (!recipe.archiveUrls.length) throw new Error("source recipe requires archiveUrls");
  if (!recipe.allowedHosts.length) throw new Error("source recipe requires allowedHosts");
  if (!recipe.documents.length) throw new Error("source recipe requires document rules");
  if (!recipe.crawl) return;

  if (!Number.isInteger(recipe.crawl.maxDepth) || recipe.crawl.maxDepth < 0 || recipe.crawl.maxDepth > 5) {
    throw new Error("source recipe crawl maxDepth must be an integer between 0 and 5");
  }
  const maxPages = recipe.crawl.maxPages ?? 100;
  if (!Number.isInteger(maxPages) || maxPages < recipe.archiveUrls.length || maxPages > 500) {
    throw new Error("source recipe crawl maxPages must fit seed pages and be at most 500");
  }
  if (recipe.crawl.maxDepth > 0 && !recipe.crawl.follow.length) {
    throw new Error("source recipe crawl requires explicit follow patterns");
  }
}

/**
 * Generic official archive harvester.
 *
 * Crawling is intentionally bounded twice: by depth and by page count. Every
 * seed, child page and document link remains constrained to `allowedHosts`.
 * No LLM guesses semantic roles and no third-party content becomes authority.
 */
export async function harvestOfficialSource(
  recipe: OfficialSourceRecipe,
  fetcher: DocumentFetcher,
): Promise<HarvestResult> {
  validateRecipe(recipe);

  const issues: HarvestIssue[] = [];
  const editions = new Map<string, DiscoveredEdition>();
  const visited = new Set<string>();
  const queued = new Set<string>();
  const queue: CrawlQueueItem[] = [];
  const maxPages = recipe.crawl?.maxPages ?? recipe.archiveUrls.length;
  let pagesFetched = 0;
  let pagesAttempted = 0;
  let linksSeen = 0;
  let matchedDocuments = 0;

  for (const archiveUrl of recipe.archiveUrls) {
    if (!hostAllowed(archiveUrl, recipe.allowedHosts)) {
      issues.push({ archiveUrl, message: "archive URL is outside recipe allowlist" });
      continue;
    }
    try {
      const normalized = normalizeUrl(archiveUrl);
      if (!queued.has(normalized)) {
        queue.push({ url: normalized, depth: 0 });
        queued.add(normalized);
      }
    } catch {
      issues.push({ archiveUrl, message: "archive URL is invalid" });
    }
  }

  while (queue.length > 0 && pagesAttempted < maxPages) {
    const page = queue.shift();
    if (!page || visited.has(page.url)) continue;
    visited.add(page.url);
    pagesAttempted += 1;

    let fetched;
    try {
      fetched = await fetcher(page.url);
      pagesFetched += 1;
    } catch (error) {
      issues.push({
        archiveUrl: page.url,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const contentType = fetched.headers["content-type"] ?? fetched.headers["Content-Type"] ?? "";
    if (contentType && !/html|text\//i.test(contentType)) {
      issues.push({
        archiveUrl: page.url,
        message: `crawl page did not return HTML/text (${contentType})`,
      });
      continue;
    }

    const sourcePageUrl = fetched.url || page.url;
    const html = new TextDecoder().decode(fetched.bytes);
    const links = extractHtmlLinks(html, sourcePageUrl);
    linksSeen += links.length;

    for (const candidate of links) {
      if (!hostAllowed(candidate.url, recipe.allowedHosts)) continue;

      const documents = detectDocuments(recipe, candidate);
      if (
        documents.length > 0 &&
        (!recipe.acceptCandidate || recipe.acceptCandidate(candidate))
      ) {
        const year = detectYear(recipe, candidate);
        if (year !== null) {
          const editionId = recipe.edition.editionId?.(candidate, year) ?? String(year);
          const label =
            recipe.edition.label?.(candidate, year) ?? `${recipe.institution} ${year}`;
          const current = editions.get(editionId) ?? {
            editionId,
            year,
            label,
            documents: [],
          };

          if (current.year !== year) {
            issues.push({
              archiveUrl: page.url,
              message: `edition ${editionId} resolved to conflicting years ${current.year}/${year}`,
            });
          } else {
            const known = new Set(current.documents.map(stableDocumentKey));
            for (const document of documents) {
              if (known.has(stableDocumentKey(document))) continue;
              current.documents.push(document);
              known.add(stableDocumentKey(document));
              matchedDocuments += 1;
            }
            editions.set(editionId, current);
          }
        }
      }

      const nextDepth = page.depth + 1;
      if (!shouldFollow(recipe, candidate, nextDepth)) continue;
      if (visited.has(candidate.url) || queued.has(candidate.url)) continue;
      if (queue.length + pagesAttempted >= maxPages) continue;
      queue.push({ url: candidate.url, depth: nextDepth });
      queued.add(candidate.url);
    }
  }

  if (queue.length > 0 && pagesAttempted >= maxPages) {
    issues.push({
      archiveUrl: recipe.archiveUrls[0],
      message: `crawl stopped at maxPages=${maxPages} with ${queue.length} page(s) still queued`,
    });
  }

  return {
    sourceId: recipe.sourceId,
    institution: recipe.institution,
    editions: [...editions.values()]
      .map((edition) => ({ ...edition, documents: [...edition.documents] }))
      .sort(
        (left, right) =>
          left.year - right.year || left.editionId.localeCompare(right.editionId),
      ),
    issues,
    pagesFetched,
    pagesAttempted,
    linksSeen,
    matchedDocuments,
  };
}

/** Adapts a recipe directly to the existing ingestion discovery contract. */
export function createRecipeDiscovery(recipe: OfficialSourceRecipe) {
  return {
    sourceId: recipe.sourceId,
    async discover(fetcher: DocumentFetcher): Promise<DiscoveredEdition[]> {
      const result = await harvestOfficialSource(recipe, fetcher);
      return result.editions;
    },
    isAllowed(edition: DiscoveredEdition): boolean {
      if (recipe.minYear !== undefined && edition.year < recipe.minYear) return false;
      if (recipe.maxYear !== undefined && edition.year > recipe.maxYear) return false;
      return (
        edition.documents.length > 0 &&
        edition.documents.every((document) =>
          hostAllowed(document.url, recipe.allowedHosts),
        )
      );
    },
  };
}
