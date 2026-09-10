import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { auditArchivedDocument, discoverFabEditions } from "../../../../scripts/fab-source-audit.mjs";

const original = "https://www.fab.mil.br/gabarito.pdf";
const archive = `https://web.archive.org/web/20250110030820id_/${original}`;
const pdf = "%PDF-1.4\nsynthetic fixture\n%%EOF";
const document = { url: original, archiveUrl: archive, bytes: Buffer.byteLength(pdf),
  sha256: createHash("sha256").update(pdf).digest("hex") };

function responses(originStatus = 403, body = pdf, archiveStatus = 200, redirected?: string): typeof fetch {
  return async (url) => {
    const response = new Response(String(url) === original ? pdf : body,
      { status: String(url) === original ? originStatus : archiveStatus });
    Object.defineProperty(response, "url", { value: String(url) === original ? original : redirected ?? archive });
    return response;
  };
}

describe("documentos FAB arquivados", () => {
  it("descoberta lê índice CDX e exclui preliminares, outros providers e falso gabrielle", () => {
    const rows = [["original"], ...["cpcar2023_oficial.pdf", "cpcar2025_gab_oficial.pdf", "afa2024_gabarito_oficial.pdf", "cpcar2026_gab_provisorio.pdf", "cpcar2025_resultado_gabrielle.pdf"].map((name) => [`https://www.fab.mil.br/ingresso/${name}`])];
    expect(discoverFabEditions(JSON.stringify(rows), "epcar")).toEqual([2023, 2025]);
  });
  it("HTML 200 não conta como descoberta saudável", () => {
    expect(() => discoverFabEditions("<html>challenge</html>", "afa")).toThrow();
  });
  it("403 esperado não aprova origin; PDF arquivado idêntico aprova documento", async () => {
    const result = await auditArchivedDocument(document, responses());
    expect(result.origin.state).toBe("blocked-expected");
    expect(result.origin.healthy).toBe(false);
    expect(result.archive.state).toBe("healthy");
    expect(result.ok).toBe(true);
  });
  it("403 com arquivo quebrado falha", async () => {
    expect((await auditArchivedDocument(document, responses(403, "missing", 404))).ok).toBe(false);
  });
  it("200 HTML no arquivo não passa", async () => {
    expect((await auditArchivedDocument(document, responses(403, "<html>ok</html>"))).ok).toBe(false);
  });
  it("checksum alterado não passa", async () => {
    expect((await auditArchivedDocument(document, responses(403, pdf.replace("fixture", "changed")))).ok).toBe(false);
  });
  it("PDF truncado não passa mesmo com checksum coincidente", async () => {
    const body = "%PDF-1.4\ntruncated";
    expect((await auditArchivedDocument({ ...document, bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex") }, responses(403, body))).ok).toBe(false);
  });
  it("snapshot de outro documento não passa", async () => {
    expect((await auditArchivedDocument({ ...document, archiveUrl: `${archive}.other` }, responses())).ok).toBe(false);
  });
  it("redirecionamento para documento diferente não passa", async () => {
    expect((await auditArchivedDocument(document, responses(403, pdf, 200, `${archive}.other`))).ok).toBe(false);
  });
  it("origin recuperado também é verificado", async () => {
    const result = await auditArchivedDocument(document, responses(200));
    expect(result.origin.state).toBe("healthy");
    expect(result.archive.state).toBe("healthy");
  });
  it("origin recuperado não substitui silenciosamente arquivo quebrado", async () => {
    expect((await auditArchivedDocument(document, responses(200, "gone", 404))).ok).toBe(false);
  });
  it("falha de rede no arquivo reprova", async () => {
    const result = await auditArchivedDocument(document, async () => { throw new Error("offline"); });
    expect(result.ok).toBe(false);
    expect(result.archive.error).toContain("offline");
  });
});
