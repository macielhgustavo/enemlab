import { describe, expect, it } from "vitest";
import {
  corpusDocumentsForExam,
  corpusEvidence,
  parseCorpusPackageManifestV1,
} from "./corpus";

function manifest() {
  return {
    schema_version: 1,
    package_id: "demo-2024-2026",
    collection: "demo",
    display_name: "Demo Exam",
    source: "Public mirror",
    generated_from: ["sources/demo.json"],
    exams: [
      {
        year: 2026,
        label: "Demo 2026",
        source_page: "https://mirror.example/demo-2026",
        files: [
          {
            kind: "prova",
            filename: "demo-2026-prova.pdf",
            url: "https://mirror.example/demo-2026-prova.pdf",
            sha256: "a".repeat(64),
            size_bytes: 1000,
          },
          {
            kind: "gabarito",
            filename: "demo-2026-gabarito.pdf",
            url: "https://mirror.example/demo-2026-gabarito.pdf",
            sha256: "b".repeat(64),
            size_bytes: 200,
          },
        ],
      },
    ],
  };
}

describe("corpus package contract", () => {
  it("parses resolved release manifests and preserves source authority separately", () => {
    const parsed = parseCorpusPackageManifestV1(manifest());
    const evidence = corpusEvidence(parsed, "aggregator", "permission-required");

    expect(parsed.exams).toHaveLength(1);
    expect(evidence).toHaveLength(2);
    expect(evidence[0].sourceAuthority).toBe("aggregator");
    expect(evidence[0].rightsStatus).toBe("permission-required");
    expect(evidence[0].sha256).toBe("a".repeat(64));
  });

  it("maps known corpus document kinds without inventing unknown roles", () => {
    const parsed = parseCorpusPackageManifestV1(manifest());
    parsed.exams[0].files.push({
      kind: "other-document",
      filename: "other.pdf",
      url: "https://mirror.example/other.pdf",
      sha256: "c".repeat(64),
      size_bytes: 30,
    });

    expect(corpusDocumentsForExam(parsed.exams[0])).toEqual([
      { role: "objective-exam", url: "https://mirror.example/demo-2026-prova.pdf" },
      { role: "answer-key", url: "https://mirror.example/demo-2026-gabarito.pdf" },
    ]);
  });

  it("rejects duplicate URLs and malformed hashes", () => {
    const duplicate = manifest();
    duplicate.exams[0].files[1].url = duplicate.exams[0].files[0].url;
    expect(() => parseCorpusPackageManifestV1(duplicate)).toThrow(/duplicate corpus URL/i);

    const badHash = manifest();
    badHash.exams[0].files[0].sha256 = "not-a-hash";
    expect(() => parseCorpusPackageManifestV1(badHash)).toThrow(/SHA-256/i);
  });

  it("does not couple authority to redistribution rights", () => {
    const parsed = parseCorpusPackageManifestV1(manifest());
    const mirror = corpusEvidence(parsed, "mirror", "unknown")[0];
    expect(mirror.sourceAuthority).toBe("mirror");
    expect(mirror.rightsStatus).toBe("unknown");
  });
});
