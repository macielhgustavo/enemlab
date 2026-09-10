import type { DocumentFingerprint, FetchedDocument } from "../sources/ingestion";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Produces the immutable provenance fingerprint used by the ingestion engine.
 *
 * The document body is hashed, not its URL or metadata. ETag/Last-Modified are
 * retained only as supporting server hints; the canonical comparator already
 * treats SHA-256 as authoritative.
 */
export async function fingerprintFetchedDocument(
  document: FetchedDocument,
  parserVersion: string,
  importedAt: string,
): Promise<DocumentFingerprint> {
  if (!parserVersion.trim()) throw new Error("parserVersion is required");
  if (Number.isNaN(Date.parse(importedAt))) throw new Error("importedAt must be a valid timestamp");

  const body = new Uint8Array(document.bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", body);
  const headers = Object.fromEntries(
    Object.entries(document.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    url: document.url,
    contentLength: document.bytes.byteLength,
    sha256: bytesToHex(new Uint8Array(digest)),
    lastModified: headers["last-modified"],
    etag: headers.etag,
    parserVersion,
    importedAt,
  };
}
