import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@6.2.12";

const BUCKET = "native-content";
const AUDIENCE = "studium-native-publisher-v1";
const ISSUER = "https://token.actions.githubusercontent.com";
const REPOSITORY = "macielhgustavo/enemlab";
const MAIN_REF = "refs/heads/main";
const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/native-fleet.yml@${MAIN_REF}`;
const REVISION_RE = /^native-fleet@[0-9]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const SOURCE_SHA_RE = /^[0-9a-f]{64}$/;
const ALLOWED_ISSUE_PREFIXES = [
  "alternativas semânticas não foram reconhecidas integralmente;",
];
const jwks = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function textClaim(payload: JWTPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value) throw new Error(`claim ausente: ${key}`);
  return value;
}

async function authenticate(req: Request): Promise<{
  repository: string;
  workflowRef: string;
  runId: number;
  runAttempt: number;
  sha: string;
}> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("OIDC ausente");
  const token = authorization.slice(7);
  const { payload } = await jwtVerify(token, jwks, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["RS256"],
  });
  const repository = textClaim(payload, "repository");
  const ref = textClaim(payload, "ref");
  const workflowRef = textClaim(payload, "workflow_ref");
  const sha = textClaim(payload, "sha");
  const runId = Number(textClaim(payload, "run_id"));
  const runAttempt = Number(textClaim(payload, "run_attempt"));
  if (repository !== REPOSITORY) throw new Error("repositório OIDC não autorizado");
  if (ref !== MAIN_REF) throw new Error("somente main pode publicar NativePack");
  if (workflowRef !== WORKFLOW_REF) throw new Error("workflow OIDC não autorizado");
  if (!SHA_RE.test(sha)) throw new Error("SHA do workflow inválido");
  if (!Number.isSafeInteger(runId) || runId < 1) throw new Error("run_id inválido");
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error("run_attempt inválido");
  return { repository, workflowRef, runId, runAttempt, sha };
}

function base36(value: number): string {
  return Math.round(value).toString(36);
}

function rectFingerprint(rect: Record<string, unknown>): string {
  const values = [rect.x, rect.y, rect.width, rect.height].map(Number);
  if (values.some((value) => !Number.isFinite(value))) throw new Error("retângulo inválido");
  return values.map((value) => base36(value * 1_000_000)).join("-");
}

function validRect(rect: Record<string, unknown>): boolean {
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  return (
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x <= 1 && y <= 1 && width <= 1 && height <= 1 &&
    x + width <= 1.000001 && y + height <= 1.000001
  );
}

type AssetRecord = { path: string; bytes: number };
type NativeDocument = {
  documentId: string;
  providerId: string;
  year: number;
  editionId?: string;
  phase: string;
  sourceSha256: string;
  pageCount: number;
  pageAssetPattern: string;
};
type NativeExtraction = {
  markerDetected?: boolean;
  visualCompleteness?: { resolved?: boolean };
  issues?: unknown[];
};
type NativeRegion = {
  page: number;
  rect: Record<string, unknown>;
  assetPath?: string;
};
type NativeQuestion = {
  status: string;
  providerId: string;
  year: number;
  editionId?: string;
  phase: string;
  documentId: string;
  questionKey: string;
  number: number;
  extraction?: NativeExtraction;
  visualRegions?: NativeRegion[];
};
type Pack = {
  version: number;
  documents?: NativeDocument[];
  questions?: NativeQuestion[];
};

function validatePack(pack: Pack, revision: string, assets: AssetRecord[]) {
  if (!REVISION_RE.test(revision)) throw new Error("revision inválida");
  if (!pack || pack.version !== 1) throw new Error("NativePack inválido");
  const documents = Array.isArray(pack.documents) ? pack.documents : [];
  const questions = Array.isArray(pack.questions) ? pack.questions : [];
  if (documents.length !== 1) throw new Error("fleet exige um documento por pack");
  if (!questions.length) throw new Error("pack sem questões");
  const document = documents[0];
  if (!SOURCE_SHA_RE.test(String(document.sourceSha256 ?? ""))) throw new Error("source SHA inválido");
  const pageCount = Number(document.pageCount);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error("pageCount inválido");
  const edition = document.editionId ?? document.year;
  const root = `native/${document.providerId}/${edition}/${document.phase}/${document.sourceSha256.slice(0, 16)}`;
  const expectedPattern = `${root}/pages/page-{page:03d}.webp`;
  if (document.pageAssetPattern !== expectedPattern) throw new Error("pageAssetPattern divergente");
  const packId = `${document.documentId}:${document.sourceSha256}`;

  const expectedAssets = new Set<string>();
  for (let page = 1; page <= pageCount; page += 1) {
    expectedAssets.add(`${root}/pages/page-${String(page).padStart(3, "0")}.webp`);
  }
  const seenKeys = new Set<string>();
  const seenNumbers = new Set<number>();
  for (const question of questions) {
    if (question.status !== "approved") throw new Error(`Q${question.number}: status não aprovado`);
    if (question.providerId !== document.providerId || question.year !== document.year ||
        (question.editionId ?? null) !== (document.editionId ?? null) ||
        question.phase !== document.phase || question.documentId !== document.documentId) {
      throw new Error(`Q${question.number}: identidade divergente do documento`);
    }
    const key = String(question.questionKey ?? "");
    const number = Number(question.number);
    if (!key || seenKeys.has(key)) throw new Error("questionKey ausente/duplicada");
    if (!Number.isSafeInteger(number) || number < 1 || seenNumbers.has(number)) {
      throw new Error("número de questão inválido/duplicado");
    }
    seenKeys.add(key);
    seenNumbers.add(number);
    const extraction: NativeExtraction = question.extraction ?? {};
    if (extraction.markerDetected !== true) throw new Error(`Q${number}: marcador não confirmado`);
    if (extraction.visualCompleteness?.resolved !== true) {
      throw new Error(`Q${number}: completude visual não resolvida`);
    }
    for (const issue of extraction.issues ?? []) {
      if (!ALLOWED_ISSUE_PREFIXES.some((prefix) => String(issue).startsWith(prefix))) {
        throw new Error(`Q${number}: exceção de extração não autorizada`);
      }
    }
    const regions = Array.isArray(question.visualRegions) ? question.visualRegions : [];
    if (!regions.length) throw new Error(`Q${number}: sem regiões`);
    for (const region of regions) {
      const page = Number(region.page);
      const rect = region.rect ?? {};
      if (!Number.isSafeInteger(page) || page < 1 || page > pageCount || !validRect(rect)) {
        throw new Error(`Q${number}: região inválida`);
      }
      const expectedPath = `${root}/regions/page-${String(page).padStart(3, "0")}-${rectFingerprint(rect)}.webp`;
      if (region.assetPath !== expectedPath) throw new Error(`Q${number}: assetPath divergente`);
      expectedAssets.add(expectedPath);
    }
  }

  const supplied = new Set<string>();
  for (const asset of assets) {
    if (!asset || typeof asset.path !== "string" || !expectedAssets.has(asset.path)) {
      throw new Error("asset inesperado no manifest");
    }
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 10 * 1024 * 1024) {
      throw new Error(`tamanho de asset inválido: ${asset.path}`);
    }
    supplied.add(asset.path);
  }
  if (supplied.size !== expectedAssets.size || [...expectedAssets].some((path) => !supplied.has(path))) {
    throw new Error(`manifest incompleto: ${supplied.size}/${expectedAssets.size}`);
  }
  return { document, root, packId, expectedAssets: [...expectedAssets] };
}

async function runLimited<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

async function assetsExist(admin: ReturnType<typeof createClient>, root: string, expected: string[]): Promise<boolean> {
  const found = new Set<string>();
  for (const folder of ["pages", "regions"]) {
    const prefix = `${root}/${folder}`;
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) return false;
    for (const item of data ?? []) found.add(`${prefix}/${item.name}`);
  }
  return expected.every((path) => found.has(path));
}

function publishedPack(pack: Pack): Pack {
  const clone = structuredClone(pack);
  for (const question of clone.questions ?? []) question.status = "published";
  return clone;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const claims = await authenticate(req);
    const body = await req.json();
    const action = String(body.action ?? "");
    const revision = String(body.revision ?? "");
    const pack = body.pack as Pack;
    const assets = Array.isArray(body.assets) ? body.assets as AssetRecord[] : [];
    const validated = validatePack(pack, revision, assets);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) throw new Error("Supabase runtime secrets ausentes");
    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const runKey = `${claims.runId}:${claims.runAttempt}`;
    const auditId = `${runKey}:${validated.packId}`;
    const auditBase = {
      id: auditId,
      repository: claims.repository,
      workflow_ref: claims.workflowRef,
      run_id: claims.runId,
      run_attempt: claims.runAttempt,
      commit_sha: claims.sha,
      pack_id: validated.packId,
      provider_id: validated.document.providerId,
      year: validated.document.year,
      edition_id: validated.document.editionId ?? null,
      phase: validated.document.phase,
      asset_count: validated.expectedAssets.length,
      updated_at: new Date().toISOString(),
    };

    if (action === "begin") {
      const { data: existing, error: lookupError } = await admin
        .from("native_packs")
        .select("publication_source,publication_revision")
        .eq("id", validated.packId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existing?.publication_source === "github_actions" &&
          existing?.publication_revision === revision &&
          await assetsExist(admin, validated.root, validated.expectedAssets)) {
        await admin.from("native_publication_runs").upsert({
          ...auditBase,
          status: "skipped",
          report: { reason: "same-source-and-revision-already-published", revision },
        });
        return json({ skip: true, reason: "same-source-and-revision-already-published" });
      }

      const uploads = await runLimited(validated.expectedAssets, 12, async (path) => {
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (error || !data?.signedUrl) throw error ?? new Error(`falha ao assinar ${path}`);
        return { path, signedUrl: data.signedUrl };
      });
      const { error: auditError } = await admin.from("native_publication_runs").upsert({
        ...auditBase,
        status: "signed",
        report: { revision },
      });
      if (auditError) throw auditError;
      return json({ skip: false, uploads });
    }

    if (action === "finalize") {
      if (!await assetsExist(admin, validated.root, validated.expectedAssets)) {
        await admin.from("native_publication_runs").upsert({
          ...auditBase,
          status: "failed",
          report: { reason: "assets-missing-at-finalize", revision },
        });
        return json({ error: "assets ausentes no finalize" }, 409);
      }
      const now = new Date().toISOString();
      const persistedPack = publishedPack(pack);
      const { error: packError } = await admin.from("native_packs").upsert({
        id: validated.packId,
        provider_id: validated.document.providerId,
        year: validated.document.year,
        edition_id: validated.document.editionId ?? null,
        phase: validated.document.phase,
        source_sha256: validated.document.sourceSha256,
        pack: persistedPack,
        published_by: null,
        publication_source: "github_actions",
        publication_repository: claims.repository,
        publication_sha: claims.sha,
        publication_run_id: runKey,
        publication_revision: revision,
        published_at: now,
        updated_at: now,
      }, { onConflict: "id" });
      if (packError) throw packError;
      const { error: auditError } = await admin.from("native_publication_runs").upsert({
        ...auditBase,
        status: "published",
        report: { revision, questions: (pack.questions ?? []).length },
      });
      if (auditError) throw auditError;
      return json({ published: true, packId: validated.packId, assets: validated.expectedAssets.length });
    }

    return json({ error: "ação inválida" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "publisher failure" }, 401);
  }
});
