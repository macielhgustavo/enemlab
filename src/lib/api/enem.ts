// Cliente da API enem.dev (portado do v6): paginação, retry em 429, cache em memória.
import { API_BASE } from "../domain/constants";
import { discipline, questionKey } from "../domain/classify";
import { isQuestionUsableForPractice } from "../domain/question-quality";
import type { Language, Question } from "../domain/types";

const yearCache = new Map<string, Question[]>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readErrorResponse(res: Response): Promise<string> {
  try {
    const data = await res.clone().json();
    return data?.error?.message || data?.message || JSON.stringify(data);
  } catch {
    try {
      return (await res.text()).slice(0, 240);
    } catch {
      return "";
    }
  }
}

interface ApiError extends Error {
  status?: number;
}

// Resposta paginada da API: pode vir como array puro ou envelopada.
interface Envelope {
  questions?: Question[];
  data?: Question[];
  metadata?: { hasMore?: boolean; has_more?: boolean; total?: number; limit?: number };
}
type Page = Question[] | Envelope;

async function fetchPage(
  year: number,
  lang: string,
  limit: number,
  offset: number,
): Promise<Page> {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (year !== 2009 && lang) p.set("language", lang);
  let tries = 0;
  while (tries < 4) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/exams/${year}/questions?${p}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      throw new Error("Falha de rede/CORS");
    }
    if (res.ok) return await res.json();
    const msg = await readErrorResponse(res);
    if (res.status === 429) {
      tries++;
      await sleep(1200);
      continue;
    }
    const er: ApiError = new Error(`HTTP ${res.status}${msg ? `: ${msg}` : ""}`);
    er.status = res.status;
    throw er;
  }
  throw new Error("Limite de requisições da API");
}

export async function fetchExam(
  year: number,
  lang: Language,
  force = false,
): Promise<Question[]> {
  const key = `${year}|${lang}`;
  if (!force && yearCache.has(key)) return yearCache.get(key)!;

  let working: number | null = null,
    first: Page | null = null,
    last: ApiError | null = null;
  for (const lim of [100, 50, 25, 10]) {
    try {
      first = await fetchPage(year, lang, lim, 0);
      working = lim;
      break;
    } catch (e) {
      last = e as ApiError;
      if (last.status === 400 || last.status === 422) continue;
      throw e;
    }
  }
  if (!working) throw new Error(last?.message || "API rejeitou a consulta");

  const all: Question[] = [];
  let data: Page | null = first,
    offset = 0,
    safety = 0;
  while (data && safety++ < 30) {
    const q: Question[] = Array.isArray(data) ? data : data.questions || data.data || [];
    all.push(...q);
    const m = Array.isArray(data) ? {} : data.metadata || {};
    const total = m.total;
    const more =
      m.hasMore === true ||
      m.has_more === true ||
      (typeof total === "number" && offset + q.length < total);
    if (!more || !q.length) break;
    offset += q.length;
    await sleep(1050);
    data = await fetchPage(year, lang, working, offset);
  }

  const map = new Map<string, Question>();
  for (const q of all) {
    const k = `${q.index}|${q.language || ""}|${discipline(q)}`;
    if (!map.has(k)) map.set(k, q);
  }
  const qs = [...map.values()];
  if (!qs.length) throw new Error("Nenhuma questão retornada");
  yearCache.set(key, qs);
  return qs;
}

// ---- Montagem de provas ----
export function sample<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

export function dedupeByIndex(all: Question[], lang: string): Question[] {
  const by = new Map<number, Question>();
  [...all]
    .sort((a, b) => a.index - b.index)
    .forEach((q) => {
      if (!by.has(q.index) || q.language === lang) by.set(q.index, q);
    });
  return [...by.values()].sort((a, b) => a.index - b.index);
}

export function buildRealDay(all: Question[], day: 1 | 2, lang: string): Question[] {
  const wanted =
    day === 1
      ? new Set(["linguagens", "ciencias-humanas"])
      : new Set(["ciencias-natureza", "matematica"]);
  return dedupeByIndex(all.filter((q) => wanted.has(discipline(q))), lang).slice(0, 90);
}

// Prova inédita cruzando vários anos, com cota por área.
export async function buildUnseenAcrossYears(
  lang: Language,
  seenKeys: Set<string>,
  n = 90,
): Promise<Question[]> {
  const collected: Question[] = [],
    wantedAreas = ["linguagens", "ciencias-humanas", "ciencias-natureza", "matematica"],
    quota = Math.ceil(n / 4),
    per: Record<string, number> = {};
  for (const y of [2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]) {
    let all: Question[];
    try {
      all = await fetchExam(y, lang);
    } catch {
      continue;
    }
    for (const ar of wantedAreas) {
      per[ar] ??= 0;
      if (per[ar] >= quota) continue;
      const pool = all.filter(
        (q) =>
          discipline(q) === ar &&
          isQuestionUsableForPractice(q) &&
          !seenKeys.has(questionKey(q)) &&
          !collected.some((x) => questionKey(x) === questionKey(q)),
      );
      const need = Math.min(quota - per[ar], n - collected.length);
      const chosen = sample(pool, need);
      collected.push(...chosen);
      per[ar] += chosen.length;
    }
    if (collected.length >= n) break;
  }
  return collected.slice(0, n);
}
