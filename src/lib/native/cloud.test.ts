import { describe, expect, it } from "vitest";
import type { NativePack } from "./contracts";
import { nativePackId, nativePageAssetPath, nativeRegionAssetPath } from "./cloud";

const pack: NativePack = {
  version: 1,
  createdAt: "2026-09-13T22:00:00.000Z",
  documents: [
    {
      documentId: "unesp-2026-first",
      providerId: "unesp",
      year: 2026,
      phase: "first",
      sourceUrl: "https://example.com/prova.pdf",
      sourceSha256: "a".repeat(64),
      sourceBytes: 1000,
      pageCount: 40,
      pageAssetPattern: "native/unesp/2026/first/aaaaaaaaaaaaaaaa/pages/page-{page:03d}.webp",
      renderScale: 1.5,
      imageFormat: "webp",
    },
  ],
  questions: [],
};

describe("native cloud identity", () => {
  it("expande page pattern com padding estável", () => {
    expect(nativePageAssetPath(pack.documents[0].pageAssetPattern, 7)).toBe(
      "native/unesp/2026/first/aaaaaaaaaaaaaaaa/pages/page-007.webp",
    );
  });

  it("gera caminho de região por página+retângulo, independente da questão", () => {
    const root = "native/unesp/2026/first/aaaaaaaaaaaaaaaa";
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const a = nativeRegionAssetPath(root, 7, rect);
    const b = nativeRegionAssetPath(root, 7, { ...rect });
    expect(a).toBe(b);
    expect(a).toMatch(/\/regions\/page-007-/);
  });

  it("inclui SHA da fonte na identidade do pack", () => {
    expect(nativePackId(pack)).toBe(`unesp-2026-first:${"a".repeat(64)}`);
  });

  it("recusa packs multi-documento enquanto a persistência é indexada por uma prova", () => {
    const multi: NativePack = {
      ...pack,
      documents: [
        ...pack.documents,
        {
          ...pack.documents[0],
          documentId: "unesp-2025-first",
          year: 2025,
          sourceSha256: "b".repeat(64),
        },
      ],
    };
    expect(() => nativePackId(multi)).toThrow(/exatamente um documento/);
  });
});
