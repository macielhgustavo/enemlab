import type { DB } from "../domain/types";

// A chave publishable é pública por design (vai no bundle), então tirá-la do
// código não é sobre segredo: é para um fork do repositório não sincronizar
// dentro do projeto Supabase de outra pessoa. Quem protege os dados é o RLS —
// ver supabase/schema.sql e supabase/VERIFICAR-RLS.md.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

/** A sincronização só é oferecida quando o projeto está configurado. */
export const CLOUD_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

function assertConfigured() {
  if (!CLOUD_CONFIGURED) {
    throw new Error(
      "Nuvem não configurada: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY em .env.local (ver .env.example).",
    );
  }
}

const SESSION_KEY = "enem_lab_cloud_session_v1";
const CLIENT_KEY = "enem_lab_cloud_client_v1";

export type OAuthProvider = "google" | "github";

export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: number;
  user?: AuthUser;
}

export interface CloudStateRow {
  data: Partial<DB>;
  revision: number;
  updated_at: string;
}

export interface CloudSyncResponse extends CloudStateRow {
  conflict: boolean;
}

function browserStorage() {
  return typeof window !== "undefined" ? window.localStorage : null;
}

function apiHeaders(token?: string): HeadersInit {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) {
    const obj = data as Record<string, unknown> | null;
    const message =
      (obj && (obj.msg || obj.message || obj.error_description || obj.error)) ||
      `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return data as T;
}

function toSession(payload: Record<string, unknown>): AuthSession | null {
  const access = String(payload.access_token || "");
  const refresh = String(payload.refresh_token || "");
  if (!access || !refresh) return null;
  const expiresAt = Number(payload.expires_at) || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: String(payload.token_type || "bearer"),
    expires_at: expiresAt,
    user: payload.user as AuthUser | undefined,
  };
}

export function loadSession(): AuthSession | null {
  try {
    const raw = browserStorage()?.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession | null) {
  const storage = browserStorage();
  if (!storage) return;
  if (!session) storage.removeItem(SESSION_KEY);
  else storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getClientId(): string {
  const storage = browserStorage();
  if (!storage) return "server";
  const existing = storage.getItem(CLIENT_KEY);
  if (existing) return existing;
  const id = `client_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  storage.setItem(CLIENT_KEY, id);
  return id;
}

export async function signUpWithEmail(email: string, password: string): Promise<AuthSession | null> {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const payload = await parseResponse<Record<string, unknown>>(response);
  const session = toSession(payload);
  if (session) saveSession(session);
  return session;
}

export async function signInWithEmail(email: string, password: string): Promise<AuthSession> {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ email, password }),
  });
  const payload = await parseResponse<Record<string, unknown>>(response);
  const session = toSession(payload);
  if (!session) throw new Error("Sessão não retornada pelo servidor.");
  saveSession(session);
  return session;
}

export function startOAuth(provider: OAuthProvider) {
  assertConfigured();
  if (typeof window === "undefined") return;
  const redirectTo = `${window.location.origin}/account`;
  const params = new URLSearchParams({ provider, redirect_to: redirectTo });
  // Navegação deliberadamente externa para o endpoint de autorização do Supabase.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
}

export function consumeOAuthRedirect(): AuthSession | null {
  if (typeof window === "undefined" || !window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const error = params.get("error_description") || params.get("error");
  if (error) {
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    throw new Error(error);
  }
  if (!params.get("access_token")) return null;
  const session = toSession(Object.fromEntries(params.entries()));
  if (session) saveSession(session);
  window.history.replaceState({}, "", window.location.pathname + window.location.search);
  return session;
}

export async function refreshSession(session: AuthSession): Promise<AuthSession> {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const payload = await parseResponse<Record<string, unknown>>(response);
  const next = toSession(payload);
  if (!next) throw new Error("Não foi possível renovar a sessão.");
  saveSession(next);
  return next;
}

export async function ensureFreshSession(session: AuthSession): Promise<AuthSession> {
  if (session.expires_at - Math.floor(Date.now() / 1000) > 90) return session;
  return refreshSession(session);
}

export async function fetchCurrentUser(token: string): Promise<AuthUser> {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: apiHeaders(token),
  });
  return parseResponse<AuthUser>(response);
}

export async function signOutRemote(session: AuthSession | null) {
  try {
    if (session?.access_token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: apiHeaders(session.access_token),
      });
    }
  } finally {
    saveSession(null);
  }
}

export async function fetchCloudState(token: string, userId: string): Promise<CloudStateRow | null> {
  assertConfigured();
  const params = new URLSearchParams({
    select: "data,revision,updated_at",
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/user_state?${params.toString()}`, {
    headers: apiHeaders(token),
  });
  const rows = await parseResponse<CloudStateRow[]>(response);
  return rows[0] || null;
}

export async function syncCloudState(
  token: string,
  db: DB,
  baseRevision: number,
  clientId: string,
): Promise<CloudSyncResponse> {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_user_state`, {
    method: "POST",
    headers: apiHeaders(token),
    body: JSON.stringify({
      p_data: db,
      p_base_revision: baseRevision,
      p_client_id: clientId,
      p_client_updated_at: new Date().toISOString(),
    }),
  });
  const rows = await parseResponse<CloudSyncResponse[]>(response);
  const row = rows[0];
  if (!row) throw new Error("Sincronização não retornou estado.");
  return row;
}
