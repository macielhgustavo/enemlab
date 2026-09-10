import { describe, expect, it } from "vitest";
import type { DocumentFetcher } from "../sources/ingestion";
import { createRecipeDiscovery, harvestOfficialSource, type OfficialSourceRecipe } from "./sourceRecipe";

const recipe: OfficialSourceRecipe = {
  sourceId: "test-official-archive",
  institution: "TEST",
  archiveUrls: ["https://vest.test.edu.br/provas-antigas"],
  allowedHosts: ["vest.test.edu.br", "static.test.edu.br"],
  minYear: 2020,
  maxYear: 2026,
  edition: {
    year: /(?:^|\D)(20\d{2})(?:\D|$)/,
  },
  documents: [
    { role: "answer-key", match: /gabarito|answer[-_ ]?key/i, phase: "first" },
    { role: "objective-exam", match: /prova|caderno|exam/i, phase: "first" },
  ],
};

function htmlFetcher(html: string): DocumentFetcher {
  return async (url) => ({
    url,
    bytes: new TextEncoder().encode(html),
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("official source recipe harvesting", () => {
  it("discovers years and document roles from one official archive page", async () => {
    const result = await harvestOfficialSource(
      recipe,
      htmlFetcher(`
        <a href="https://static.test.edu.br/2025/prova.pdf">Prova 2025</a>
        <a href="https://static.test.edu.br/2025/gabarito.pdf">Gabarito 2025</a>
        <a href="/2024/prova-final.pdf">Caderno 2024</a>
        <a href="/2024/gabarito-final.pdf">Gabarito final 2024</a>
      `),
    );

    expect(result.issues).toEqual([]);
    expect(result.pagesFetched).toBe(1);
    expect(result.linksSeen).toBe(4);
    expect(result.matchedDocuments).toBe(4);
    expect(result.editions.map((edition) => edition.year)).toEqual([2024, 2025]);
    expect(result.editions[1].documents.map((document) => document.role).sort()).toEqual([
      "answer-key",
      "objective-exam",
    ]);
  });

  it("rejects discovered documents outside the host allowlist", async () => {
    const result = await harvestOfficialSource(
      recipe,
      htmlFetcher(`
        <a href="https://evil.example/2025/prova.pdf">Prova 2025</a>
        <a href="https://static.test.edu.br/2025/gabarito.pdf">Gabarito 2025</a>
      `),
    );

    expect(result.editions).toHaveLength(1);
    expect(result.editions[0].documents).toHaveLength(1);
    expect(result.editions[0].documents[0].role).toBe("answer-key");
  });

  it("ignores years outside the recipe range", async () => {
    const result = await harvestOfficialSource(
      recipe,
      htmlFetcher(`
        <a href="https://static.test.edu.br/2019/prova.pdf">Prova 2019</a>
        <a href="https://static.test.edu.br/2025/prova.pdf">Prova 2025</a>
      `),
    );

    expect(result.editions).toHaveLength(1);
    expect(result.editions[0].year).toBe(2025);
  });

  it("adapts recipes to ExamSourceDiscovery without weakening allowlist checks", async () => {
    const discovery = createRecipeDiscovery(recipe);
    const editions = await discovery.discover(
      htmlFetcher(`
        <a href="https://static.test.edu.br/2026/prova.pdf">Prova 2026</a>
        <a href="https://static.test.edu.br/2026/gabarito.pdf">Gabarito 2026</a>
      `),
    );

    expect(editions).toHaveLength(1);
    expect(discovery.isAllowed(editions[0])).toBe(true);
    expect(
      discovery.isAllowed({
        ...editions[0],
        documents: [{ role: "objective-exam", url: "https://evil.example/2026/prova.pdf" }],
      }),
    ).toBe(false);
  });
});
