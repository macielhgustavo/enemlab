"use client";
// Estado central persistido (Zustand). Substitui o `db` global + saveDB do v6.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { FINAL_BUILD, FINAL_SCHEMA } from "./domain/constants";
import type { Attempt, DB, Goals } from "./domain/types";

const STORAGE_KEY = "enem_lab_v7";

export function defaultDB(): DB {
  return {
    v: 6,
    schema: FINAL_SCHEMA,
    build: FINAL_BUILD,
    // O produto é desenhado no escuro; claro fica como alternativa.
    theme: "dark",
    attempts: [],
    notes: {},
    srs: {},
    sessions: [],
    goals: { questions: 150, essays: 2, reviews: 30 },
    activeProvider: "enem",
    lastOpened: null,
    lastBackupAt: null,
  };
}

// Garante campos e normaliza tentativas (equivalente ao ensureFinalSchema).
export function ensureSchema(db: DB): DB {
  db.v = 6;
  db.schema = FINAL_SCHEMA;
  db.build = FINAL_BUILD;
  db.notes ||= {};
  db.srs ||= {};
  db.attempts ||= [];
  db.sessions ||= [];
  db.goals ||= { questions: 150, essays: 2, reviews: 30 };
  for (const a of db.attempts) {
    a.answers ||= {};
    a.confidence ||= {};
    a.flags ||= {};
    a.timeQ ||= {};
    if (a.result?.rows)
      for (const r of a.result.rows) {
        r.tags ||= r.content ? [r.content] : [];
        r.tags = [...new Set((r.tags || []).filter(Boolean))];
      }
  }
  return db;
}

interface StoreState {
  db: DB;
  hydrated: boolean;
  /** Aplica uma mutação sobre uma cópia do db e persiste. */
  mutate: (mutator: (db: DB) => void) => void;
  setTheme: (theme: "light" | "dark") => void;
  setActiveProvider: (providerId: string) => void;
  toggleTheme: () => void;
  addAttempt: (a: Attempt) => void;
  replaceDB: (db: DB) => void;
  mergeDB: (incoming: Partial<DB>) => void;
  setGoals: (goals: Goals) => void;
  wipe: () => void;
  setHydrated: () => void;
}

function clone<T>(x: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(x)
    : JSON.parse(JSON.stringify(x));
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      db: defaultDB(),
      hydrated: false,
      mutate: (mutator) =>
        set((state) => {
          const db = clone(state.db);
          mutator(db);
          return { db };
        }),
      setTheme: (theme) => get().mutate((db) => { db.theme = theme; }),
      setActiveProvider: (providerId) =>
        get().mutate((db) => { db.activeProvider = providerId; }),
      toggleTheme: () =>
        get().mutate((db) => { db.theme = db.theme === "dark" ? "light" : "dark"; }),
      addAttempt: (a) =>
        get().mutate((db) => {
          db.attempts.unshift(a);
          db.lastOpened = a.id;
        }),
      replaceDB: (db) => set({ db: ensureSchema(clone(db)) }),
      mergeDB: (incoming) =>
        get().mutate((db) => {
          const by = new Map(db.attempts.map((a) => [a.id, a]));
          (incoming.attempts || []).forEach((a) => {
            if (!by.has(a.id)) db.attempts.push(a);
          });
          db.notes = { ...(incoming.notes || {}), ...db.notes };
          db.srs = { ...(incoming.srs || {}), ...db.srs };
        }),
      setGoals: (goals) => get().mutate((db) => { db.goals = goals; }),
      wipe: () => set({ db: defaultDB() }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ db: state.db }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          ensureSchema(state.db);
          state.setHydrated();
        }
      },
    },
  ),
);
