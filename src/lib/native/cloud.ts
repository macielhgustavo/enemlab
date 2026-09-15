import {
  CLOUD_CONFIGURED,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "../cloud/client";
import type { AuthSession } from "../cloud/client";
import type { NativePack, NativeRect } from "./contracts";
import { markNativePackPublished, nativePackGate } from "./review";

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

function contentAddressedPagePattern(pack: NativePack, documentId: string): string {
  const document = pack.documents.find((candidate) => candidate.documentId === documentId);
  if (!document) throw new Error(`Documento ausente: ${documentId}`);
  const edition = document.editionId ?? String(document.year);
  return [
    "native",
    document.providerId,
    edition,
    document.phase,
    document.sourceSha256.slice(0, 16),
    "pages",
    "page-{page:03d}.webp",
  ].join("/");
}

function rectFingerprint(rect: NativeRect): string {
  return [rect.x, rect.y, rect.width, rect.height]
    .map((value) => Math.round(value * 1_000_000).toString(36))
    .join("-");
}

export function nativeRegionAssetPath(root: string, page: number, rect: NativeRect): string {
  return `${root}/regions/page-${String(page).padStart(3, "0")}-${rectFingerprint(rect)}.webp`;
}

async function cropWebp(file: File, rect: NativeRect): Promise<Blob> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    throw new Error("Recorte nativo só pode ser gerado no navegador.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const sx = Math.round(rect.x * bitmap.width);
    const sy = Math.round(rect.y * bitmap.height);
    const sw = Math.max(1, Math.round(rect.width * bitmap.width));
    const sh = Math.max(1, Math.round(rect.height * bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível para gerar recorte nativo.");
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
    if (!blob) throw new Error("Falha ao codificar recorte WebP.");
    return blob;
  } finally {
    bitmap.close();
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  let cursor = 0;
  const count = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * O schema `native_packs` indexa provider/ano/edição/fase de um único
 * documento. Até existir persistência multi-documento explícita, publicar um
 * pack com mais de um documento deixaria parte dos assets sem lookup correto.
 */
export function nativePackId(pack: NativePack): string {
  if (pack.documents.length !== 1) {
    throw new Error("NativePack publicável precisa conter exatamente um documento.");
  }
  const document = pack.documents[0];
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
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
  return response.blob();
}

export async function createNativeSignedUrls(
  token: string,
  paths: string[],
  expiresIn = 43_200,
): Promise<Map<string, string>> {
  assertNativeCloud();
  if (!paths.length) return new Map();
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${NATIVE_BUCKET}`, {
    method: "POST",
    headers: headers(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn, paths }),
  });
  const text = await responseText(response);
  const rows = JSON.parse(text || "[]") as Array<{
    error?: string | null;
    path?: string | null;
    signedURL?: string | null;
  }>;
  const out = new Map<string, string>();
  for (const row of rows) {
    if (!row.path || !row.signedURL || row.error) continue;
    out.set(row.path, encodeURI(`${SUPABASE_URL}/storage/v1${row.signedURL}`));
  }
  return out;
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
    throw new Error(text || "Falha ao publicar asset nativo.");
  }
  await responseText(response);
}

function clonePack(pack: NativePack): NativePack {
  return JSON.parse(JSON.stringify(pack)) as NativePack;
}

export async function publishNativePack(
  session: AuthSession,
  pack: NativePack,
  pages: Map<string, File>,
): Promise<{ id: string; uploadedPages: number; uploadedCrops: number; pack: NativePack }> {
  assertNativeCloud();
  // Valida a forma persistível antes de qualquer upload para não deixar assets
  // órfãos de um pack que o schema atual não conseguiria indexar corretamente.
  const packId = nativePackId(pack);
  const gate = nativePackGate(pack);
  if (!gate.publishable) {
    throw new Error(`NativePack ainda não pode ser publicado (${gate.published}/${gate.total} aprovado).`);
  }
  const userId = session.user?.id;
  if (!userId) throw new Error("Sessão sem usuário identificado.");

  const preparedPack = clonePack(pack);

  type PageJob = { path: string; file: File };
  const pageJobs: PageJob[] = [];
  for (const documentRecord of preparedPack.documents) {
    documentRecord.pageAssetPattern = contentAddressedPagePattern(preparedPack, documentRecord.documentId);
    for (let page = 1; page <= documentRecord.pageCount; page += 1) {
      const path = nativePageAssetPath(documentRecord.pageAssetPattern, page);
      const filename = `page-${String(page).padStart(3, "0")}.webp`;
      const file = pages.get(filename) ?? pages.get(path);
      if (!file) throw new Error(`Página ausente para publicação: ${filename}`);
      pageJobs.push({ path, file });
    }
  }

  // A rede/storage é o gargalo aqui; uploads paralelos limitados reduzem muito
  // o tempo sem criar dezenas de requisições simultâneas em celular.
  await runWithConcurrency(pageJobs, 6, async ({ path, file }) => {
    await uploadNativeAsset(session.access_token, path, file);
  });

  type CropJob = { path: string; file: File; rect: NativeRect };
  const cropJobs = new Map<string, CropJob>();
  for (const question of preparedPack.questions) {
    const documentRecord = preparedPack.documents.find(
      (candidate) => candidate.documentId === question.documentId,
    );
    if (!documentRecord) throw new Error(`Documento ausente: ${question.documentId}`);
    const root = documentRecord.pageAssetPattern.replace(/\/pages\/page-\{page:03d\}\.webp$/, "");
    for (const region of question.visualRegions) {
      const filename = `page-${String(region.page).padStart(3, "0")}.webp`;
      const pageFile = pages.get(filename);
      if (!pageFile) throw new Error(`Página ausente para recorte: ${filename}`);
      const path = nativeRegionAssetPath(root, region.page, region.rect);
      region.assetPath = path;
      if (!cropJobs.has(path)) cropJobs.set(path, { path, file: pageFile, rect: region.rect });
    }
  }

  // Shared-context deixa de gerar N cópias idênticas: o path é função de
  // página+retângulo e todas as questões apontam para o mesmo objeto.
  await runWithConcurrency([...cropJobs.values()], 4, async ({ path, file, rect }) => {
    const crop = await cropWebp(file, rect);
    await uploadNativeAsset(session.access_token, path, crop);
  });

  // `published` é reservado para o estado que realmente será persistido após
  // todos os assets necessários terem sido preparados/enviados com sucesso.
  const publishedPack = markNativePackPublished(preparedPack);
  const documentRecord = publishedPack.documents[0];
  const row = {
    id: packId,
    provider_id: documentRecord.providerId,
    year: documentRecord.year,
    edition_id: documentRecord.editionId ?? null,
    phase: documentRecord.phase,
    source_sha256: documentRecord.sourceSha256,
    pack: publishedPack,
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
  return {
    id: row.id,
    uploadedPages: pageJobs.length,
    uploadedCrops: cropJobs.size,
    pack: publishedPack,
  };
}
