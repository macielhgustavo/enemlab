import { describe, expect, it } from "vitest";
import { fingerprintFetchedDocument } from "./fingerprint";

describe("fingerprintFetchedDocument", () => {
  it("hashes document bytes and normalizes metadata header names", async () => {
    const fingerprint = await fingerprintFetchedDocument(
      {
        url: "https://example.edu/exam.pdf",
        bytes: new TextEncoder().encode("abc"),
        headers: {
          ETag: '"v1"',
          "Last-Modified": "Wed, 09 Sep 2026 12:00:00 GMT",
        },
      },
      "parser@1",
      "2026-09-09T23:00:00.000Z",
    );

    expect(fingerprint.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(fingerprint.contentLength).toBe(3);
    expect(fingerprint.etag).toBe('"v1"');
    expect(fingerprint.lastModified).toBe("Wed, 09 Sep 2026 12:00:00 GMT");
  });
});
