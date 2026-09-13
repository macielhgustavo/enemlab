import {
  CLOUD_CONFIGURED,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "../cloud/client";
import type { AuthSession } from "../cloud/client";
import type { NativePack } from "./contracts";
import { nativePackGate } from "./review";

export const NATIVE_BUCKET = "native-content";

function assertNativeCloud() {
  if (!CLOUD_CONFIGURED) throw new Error("Supabase não está configurado para conteúdo nativo.");
}

function headers(token: string, extra?: HeadersInit): HeadersInit {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function responseText(response: Response): Promise<string> {
  const text = await response.text();
  if (!response.ok) {
    let message = text || `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      // Mantém a resposta textual original.
    }
    throw new Error(message);
  }
  return text;
}

function encodeStoragePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function nativePageAssetPath(pattern: string, page: number): string {
  return pattern
    .replace("{page:03d}", String(page).padStart(3, "0"))
    .replace("{page}", String(page));
}

export function nativePackId(pack: NativePack): string {
  const document = pack.documents[0];
  if (!document) throw new Error("NativePack sem documento.");
  return `${document.documentId}:${document.sourceSha256}`;
}

export interface NativePackLookup {
  providerId: string;
  year: number;
  editionId?: string;
  phase: string;
}

export async function fetchPublishedNativePack(
  token: string,
  lookup: NativePackLookup,
): Promise<NativePack | null> {
  assertNativeCloud();
  const params = new URLSearchParams({
    select: "pack",
    provider_id: `eq.${lookup.providerId}`,
    year: `eq.${lookup.year}`,
    phase: `eq.${lookup.phase}`,
    order: "updated_at.desc",
    limit: "1",
  });
  params.set("edition_id", lookup.editionId ? `eq.${lookup.editionId}` : "is.null");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/native_packs?${params.toString()}`, {
    headers: headers(token),
  });
  const text = await responseText(response);
  const rows = JSON.parse(text || "[]") as Array<{ pack: NativePack }>;
  return rows[0]?.pack ?? null;
}

export async function fetchNativeAssetBlob(token: string, path: string): Promise<Blob> {
  assertNativeCloud();
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${NATIVE_BUCKET}/${encodeStoragePath(path)}`,
    { headers: headers(token) },
  );
  if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
  return response.blob();
}

export async function uploadNativeAsset(
  token: string,
  path: string,
  file: Blob,
): Promise<void> {
  assertNativeCloud();
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${NATIVE_BUCKET}/${encodeStoragePath(path)}`,
    {
      method: "POST",
      headers: headers(token, {
        "Content-Type": "image/webp",
        "cache-control": "31536000",
        "x-upsert": "false",
      }),
      body: file,
    },
  );
  if (response.status === 400) {
    const text = await response.text();
    if (/already exists|duplicate/i.test(text)) return;
    throw new Error(text || "Falha ao publicar página nativa.");
  }
  await responseText(response);
}

export async function publishNativePack(
  session: AuthSession,
  pack: NativePack,
  pages: Map<string, File>,
): Promise<{ id: string; uploadedPages: number }> {
  assertNativeCloud();
  const gate = nativePackGate(pack);
  if (!gate.publishable) {
    throw new Error(`NativePack ainda não pode ser publicado (${gate.published}/${gate.total} aprovado).`);
  }
  const userId = session.user?.id;
  if (!userId) throw new Error("Sessão sem usuário identificado.");

  let uploadedPages = 0;
  for (const document of pack.documents) {
    for (let page = 1; page <= document.pageCount; page += 1) {
      const assetPath = nativePageAssetPath(document.pageAssetPattern, page);
      const filename = assetPath.split("/").at(-1)!;
      const file = pages.get(filename) ?? pages.get(assetPath);
      if (!file) throw new Error(`Página ausente para publicação: ${filename}`);
      await uploadNativeAsset(session.access_token, assetPath, file);
      uploadedPages += 1;
    }
  }

  const document = pack.documents[0];
  const row = {
    id: nativePackId(pack),
    provider_id: document.providerId,
    year: document.year,
    edition_id: document.editionId ?? null,
    phase: document.phase,
    source_sha256: document.sourceSha256,
    pack,
    published_by: userId,
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/native_packs?on_conflict=id`, {
    method: "POST",
    headers: headers(session.access_token, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(row),
  });
  await responseText(response);
  return { id: row.id, uploadedPages };
}
