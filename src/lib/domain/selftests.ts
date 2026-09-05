// Autotestes de integridade da instalação (portados do v6).
import { FINAL_SCHEMA } from "./constants";
import { rebuildSessions } from "./stats";
import type { DB } from "./types";

export interface SelfTest {
  name: string;
  ok: boolean;
  detail: string;
  warn?: boolean;
}

export function runSelfTests(db: DB): SelfTest[] {
  const tests: SelfTest[] = [];
  const add = (name: string, ok: boolean, detail = "", warn = false) =>
    tests.push({ name, ok, detail, warn });

  add(
    "Esquema do banco",
    db.v === 6 && Number(db.schema) >= FINAL_SCHEMA,
    `v=${db.v} schema=${db.schema || "—"}`,
  );

  const ids = db.attempts.map((a) => a.id).filter(Boolean);
  const dup = ids.length - new Set(ids).size;
  add("IDs de tentativas únicos", dup === 0, dup ? `${dup} duplicata(s)` : "sem duplicatas");

  const invalid = db.attempts.filter(
    (a) => !a.id || !Array.isArray(a.questionRefs) || !a.startedAt,
  );
  add("Tentativas estruturadas", invalid.length === 0, invalid.length ? `${invalid.length} inválida(s)` : "OK");

  const badDates = Object.values(db.srs).filter(
    (x) => !x.due || Number.isNaN(new Date(x.due).getTime()),
  );
  add("Datas do SRS", badDates.length === 0, badDates.length ? `${badDates.length} inválida(s)` : "OK");

  const unresolved = db.attempts.filter(
    (a) => a.result && a.result.rows?.some((r) => r.isCorrect === undefined),
  );
  add(
    "Resultados corrigidos",
    unresolved.length === 0,
    unresolved.length ? `${unresolved.length} com linha incompleta` : "OK",
    unresolved.length > 0,
  );

  const sessions = rebuildSessions(db);
  add("Sessões reconstruíveis", Array.isArray(sessions), `${sessions.length} sessão(ões)`);

  return tests;
}
