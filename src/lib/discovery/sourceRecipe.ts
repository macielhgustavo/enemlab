import type { DiscoveredDocument, DiscoveredEdition, DocumentFetcher, DocumentRole } from "../sources/ingestion";

export interface SourceLinkCandidate {
  url: string;
  text: string;
}

export interface SourceRecipeDocumentRule {
  role: DocumentRole;
  /** Matcher against the normalized absolute URL and visible anchor text. */
  match: RegExp;
  phase?: string;
  subject?: string;
  variant?: string;
}

export interface SourceRecipeEditionRule {
  /** Extracts the edition year from URL/text. Must expose the year in capture group 1. */
  year: RegExp;
  /** Optional stable edition id override. Defaults to the four-digit year. */
  editionId?: (candidate: SourceLinkCandidate, year: number) => string;
  label?: (candidate: SourceLinkCandidate, year: number) => string;
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
  /** Optional filter for non-document links after role matching. */
  acceptCandidate?: (candidate: SourceLinkCandidate) => boolean;
}

export interface HarvestIssue {
  archiveUrl: string;
  message: string;
}

export interface HarvestResult {
  sourceId: string;
  institution: string;
  editions: DiscoveredEdition[];
  issues: HarvestIssue[];
  pagesFetched: number;
  linksSeen: number;
  matchedDocuments: number;
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

export function extractHtmlLinks(html: string, baseUrl: string): SourceLinkCandidate[] {
  const links: SourceLinkCandidate[] = [];
  const anchor = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html))) {
    const href = decodeHtml(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!href || href.startsWith("#") || /^javascript:/i.test(href) || /^mailto:/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      links.push({ url: url.toString(), text: stripTags(match[4] ?? "") });
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
  return `${candidate.text}\n${candidate.url}`;
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

function detectDocument(recipe: OfficialSourceRecipe, candidate: SourceLinkCandidate): DiscoveredDocument | null {
  const corpus = candidateCorpus(candidate);
  for (const rule of recipe.documents) {
    if (!matchRegex(rule.match, corpus)) continue;
    return {
      role: rule.role,
      url: candidate.url,
      phase: rule.phase,
      subject: rule.subject,
      variant: rule.variant,
    };
  }
  return null;
}

function stableDocumentKey(document: DiscoveredDocument): string {
  return [document.role, document.phase ?? "", document.subject ?? "", document.variant ?? "", document.url].join("|");
}

/**
 * Generic official archive harvester.
 *
 * It intentionally understands only HTML links and recipe-declared patterns.
 * It does not crawl the open web, guess semantic roles with an LLM or trust
 * third-party content. Institution-specific knowledge lives in small recipes.
 */
export async function harvestOfficialSource(
  recipe: OfficialSourceRecipe,
  fetcher: DocumentFetcher,
): Promise<HarvestResult> {
  if (!recipe.sourceId.trim()) throw new Error("source recipe requires sourceId");
  if (!recipe.institution.trim()) throw new Error("source recipe requires institution");
  if (!recipe.archiveUrls.length) throw new Error("source recipe requires archiveUrls");
  if (!recipe.allowedHosts.length) throw new Error("source recipe requires allowedHosts");

  const issues: HarvestIssue[] = [];
  const editions = new Map<string, DiscoveredEdition>();
  let pagesFetched = 0;
  let linksSeen = 0;
  let matchedDocuments = 0;

  for (const archiveUrl of recipe.archiveUrls) {
    if (!hostAllowed(archiveUrl, recipe.allowedHosts)) {
      issues.push({ archiveUrl, message: "archive URL is outside recipe allowlist" });
      continue;
    }

    let fetched;
    try {
      fetched = await fetcher(archiveUrl);
      pagesFetched += 1;
    } catch (error) {
      issues.push({
        archiveUrl,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const contentType = fetched.headers["content-type"] ?? fetched.headers["Content-Type"] ?? "";
    if (contentType && !/html|text\//i.test(contentType)) {
      issues.push({ archiveUrl, message: `archive did not return HTML/text (${contentType})` });
      continue;
    }

    const html = new TextDecoder().decode(fetched.bytes);
    const links = extractHtmlLinks(html, fetched.url || archiveUrl);
    linksSeen += links.length;

    for (const candidate of links) {
      if (!hostAllowed(candidate.url, recipe.allowedHosts)) continue;
      if (recipe.acceptCandidate && !recipe.acceptCandidate(candidate)) continue;
      const year = detectYear(recipe, candidate);
      if (year === null) continue;
      const document = detectDocument(recipe, candidate);
      if (!document) continue;

      const editionId = recipe.edition.editionId?.(candidate, year) ?? String(year);
      const label = recipe.edition.label?.(candidate, year) ?? `${recipe.institution} ${year}`;
      const current = editions.get(editionId) ?? { editionId, year, label, documents: [] };
      if (current.year !== year) {
        issues.push({
          archiveUrl,
          message: `edition ${editionId} resolved to conflicting years ${current.year}/${year}`,
        });
        continue;
      }
      const known = new Set(current.documents.map(stableDocumentKey));
      if (!known.has(stableDocumentKey(document))) {
        current.documents.push(document);
        matchedDocuments += 1;
      }
      editions.set(editionId, current);
    }
  }

  return {
    sourceId: recipe.sourceId,
    institution: recipe.institution,
    editions: [...editions.values()]
      .map((edition) => ({ ...edition, documents: [...edition.documents] }))
      .sort((left, right) => left.year - right.year || left.editionId.localeCompare(right.editionId)),
    issues,
    pagesFetched,
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
      return edition.documents.length > 0 && edition.documents.every((document) => hostAllowed(document.url, recipe.allowedHosts));
    },
  };
}
