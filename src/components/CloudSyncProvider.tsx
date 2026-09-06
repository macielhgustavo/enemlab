"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { rebuildSessions } from "@/lib/domain/stats";
import { mergeCloudDB } from "@/lib/cloud/merge";
import {
  CLOUD_CONFIGURED,
  consumeOAuthRedirect,
  ensureFreshSession,
  fetchCloudState,
  fetchCurrentUser,
  getClientId,
  loadSession,
  saveSession,
  signInWithEmail,
  signOutRemote,
  signUpWithEmail,
  startOAuth,
  syncCloudState,
  type AuthSession,
  type AuthUser,
  type OAuthProvider,
} from "@/lib/cloud/client";

export type CloudStatus = "loading" | "signed-out" | "needs-merge" | "idle" | "syncing" | "offline" | "error";

interface CloudContextValue {
  user: AuthUser | null;
  status: CloudStatus;
  error: string | null;
  lastSyncAt: string | null;
  revision: number;
  cloudExists: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<"signed-in" | "confirm-email">;
  signInOAuth: (provider: OAuthProvider) => void;
  mergeAndEnable: () => Promise<void>;
  syncNow: () => Promise<void>;
  signOut: () => Promise<void>;
}

const CloudContext = createContext<CloudContextValue | null>(null);
const LINK_PREFIX = "enem_lab_cloud_linked_v1:";
const LAST_SYNC_PREFIX = "enem_lab_cloud_last_sync_v1:";

function linkedKey(userId: string) {
  return `${LINK_PREFIX}${userId}`;
}

function lastSyncKey(userId: string) {
  return `${LAST_SYNC_PREFIX}${userId}`;
}

function normalizeAndRebuild(localDb: ReturnType<typeof useStore.getState>["db"], cloud: unknown) {
  const merged = mergeCloudDB(localDb, (cloud || {}) as Partial<typeof localDb>);
  rebuildSessions(merged);
  return merged;
}

export default function CloudSyncProvider({ children }: { children: React.ReactNode }) {
  const db = useStore((s) => s.db);
  const hydrated = useStore((s) => s.hydrated);
  const replaceDB = useStore((s) => s.replaceDB);

  const dbRef = useRef(db);
  const sessionRef = useRef<AuthSession | null>(null);
  const revisionRef = useRef(0);
  const linkedRef = useRef(false);
  const syncingRef = useRef(false);

  const [user, setUser] = useState<AuthUser | null>(null);
  // Sem projeto Supabase configurado o app nunca sai do modo local.
  const [status, setStatus] = useState<CloudStatus>(
    CLOUD_CONFIGURED ? "loading" : "signed-out",
  );
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [cloudExists, setCloudExists] = useState(false);

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const commitSyncMeta = useCallback((userId: string, nextRevision: number, at: string) => {
    revisionRef.current = nextRevision;
    setRevision(nextRevision);
    setLastSyncAt(at);
    localStorage.setItem(lastSyncKey(userId), at);
  }, []);

  const syncWithSession = useCallback(
    async (rawSession: AuthSession, allowConflictMerge = true) => {
      if (syncingRef.current || !linkedRef.current) return;
      syncingRef.current = true;
      setStatus("syncing");
      setError(null);
      try {
        const session = await ensureFreshSession(rawSession);
        if (session !== rawSession) sessionRef.current = session;
        const currentUser = session.user || (await fetchCurrentUser(session.access_token));
        session.user = currentUser;
        saveSession(session);
        sessionRef.current = session;

        let result = await syncCloudState(
          session.access_token,
          dbRef.current,
          revisionRef.current,
          getClientId(),
        );

        if (result.conflict && allowConflictMerge) {
          const merged = normalizeAndRebuild(dbRef.current, result.data);
          replaceDB(merged);
          dbRef.current = merged;
          result = await syncCloudState(
            session.access_token,
            merged,
            result.revision,
            getClientId(),
          );
        }

        if (result.conflict) throw new Error("A nuvem mudou novamente. Tente sincronizar mais uma vez.");
        const at = result.updated_at || new Date().toISOString();
        commitSyncMeta(currentUser.id, result.revision, at);
        setCloudExists(true);
        setStatus("idle");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Falha ao sincronizar.";
        setError(message);
        setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      } finally {
        syncingRef.current = false;
      }
    },
    [commitSyncMeta, replaceDB],
  );

  const bootstrapSession = useCallback(async (incoming: AuthSession) => {
    try {
      let session = await ensureFreshSession(incoming);
      const currentUser = session.user || (await fetchCurrentUser(session.access_token));
      session = { ...session, user: currentUser };
      saveSession(session);
      sessionRef.current = session;
      setUser(currentUser);

      const cloud = await fetchCloudState(session.access_token, currentUser.id);
      const rev = cloud?.revision || 0;
      revisionRef.current = rev;
      setRevision(rev);
      setCloudExists(!!cloud);
      const savedAt = localStorage.getItem(lastSyncKey(currentUser.id));
      setLastSyncAt(savedAt || cloud?.updated_at || null);

      const isLinked = localStorage.getItem(linkedKey(currentUser.id)) === "1";
      linkedRef.current = isLinked;
      if (!isLinked) {
        setStatus("needs-merge");
        return;
      }
      setStatus("idle");
    } catch (err) {
      saveSession(null);
      sessionRef.current = null;
      setUser(null);
      setError(err instanceof Error ? err.message : "Sessão inválida.");
      setStatus("signed-out");
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Sem projeto configurado o app é local: não tenta rede. O status já
    // nasce "signed-out" na inicialização do estado, então nada a fazer aqui.
    if (!CLOUD_CONFIGURED) return;
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setError(null);
      try {
        const oauth = consumeOAuthRedirect();
        const session = oauth || loadSession();
        if (!session) {
          if (!cancelled) setStatus("signed-out");
          return;
        }
        if (!cancelled) await bootstrapSession(session);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao iniciar sessão.");
          setStatus("signed-out");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapSession, hydrated]);

  useEffect(() => {
    if (!hydrated || status !== "idle" || !user || !linkedRef.current || !sessionRef.current) return;
    const timer = window.setTimeout(() => {
      if (sessionRef.current) void syncWithSession(sessionRef.current);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [db, hydrated, status, syncWithSession, user]);

  useEffect(() => {
    const onOnline = () => {
      if (linkedRef.current && sessionRef.current) void syncWithSession(sessionRef.current);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [syncWithSession]);

  const signInEmail = useCallback(
    async (email: string, password: string) => {
      setStatus("loading");
      setError(null);
      try {
        const session = await signInWithEmail(email.trim(), password);
        await bootstrapSession(session);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível entrar.");
        setStatus("signed-out");
        throw err;
      }
    },
    [bootstrapSession],
  );

  const signUpEmail = useCallback(
    async (email: string, password: string) => {
      setStatus("loading");
      setError(null);
      try {
        const session = await signUpWithEmail(email.trim(), password);
        if (!session) {
          setStatus("signed-out");
          return "confirm-email" as const;
        }
        await bootstrapSession(session);
        return "signed-in" as const;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível criar a conta.");
        setStatus("signed-out");
        throw err;
      }
    },
    [bootstrapSession],
  );

  const mergeAndEnable = useCallback(async () => {
    const session = sessionRef.current;
    const currentUser = user;
    if (!session || !currentUser) return;
    setStatus("syncing");
    setError(null);
    try {
      const fresh = await ensureFreshSession(session);
      sessionRef.current = fresh;
      const cloud = await fetchCloudState(fresh.access_token, currentUser.id);
      const merged = normalizeAndRebuild(dbRef.current, cloud?.data);
      replaceDB(merged);
      dbRef.current = merged;
      revisionRef.current = cloud?.revision || 0;
      setRevision(revisionRef.current);
      linkedRef.current = true;
      localStorage.setItem(linkedKey(currentUser.id), "1");
      setStatus("idle");
      await syncWithSession(fresh);
    } catch (err) {
      linkedRef.current = false;
      localStorage.removeItem(linkedKey(currentUser.id));
      setError(err instanceof Error ? err.message : "Não foi possível mesclar os dados.");
      setStatus("needs-merge");
      throw err;
    }
  }, [replaceDB, syncWithSession, user]);

  const syncNow = useCallback(async () => {
    if (sessionRef.current && linkedRef.current) await syncWithSession(sessionRef.current);
  }, [syncWithSession]);

  const signOut = useCallback(async () => {
    const old = sessionRef.current;
    await signOutRemote(old);
    sessionRef.current = null;
    linkedRef.current = false;
    revisionRef.current = 0;
    setRevision(0);
    setUser(null);
    setCloudExists(false);
    setLastSyncAt(null);
    setError(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo<CloudContextValue>(
    () => ({
      user,
      status,
      error,
      lastSyncAt,
      revision,
      cloudExists,
      signInEmail,
      signUpEmail,
      signInOAuth: startOAuth,
      mergeAndEnable,
      syncNow,
      signOut,
    }),
    [cloudExists, error, lastSyncAt, mergeAndEnable, revision, signInEmail, signOut, signUpEmail, status, syncNow, user],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloudSync() {
  const value = useContext(CloudContext);
  if (!value) throw new Error("useCloudSync precisa estar dentro de CloudSyncProvider.");
  return value;
}
