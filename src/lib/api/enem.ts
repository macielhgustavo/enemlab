// Cliente da API ENEM: paginação por índice, rate-limit e cache em memória.
import { API_BASE } from "../domain/constants";
import { discipline, questionKey } from "../domain/classify";
import { isQuestionUsableForPractice } from "../domain/question-quality";
import type { Language, Question } from "../domain/types";

const API_PAGE_LIMIT = 50;
const PAGE_INTERVAL_MS = 1050;
const MAX_REQUEST_ATTEMPTS = 4;
const MAX_PAGES = 10;

const yearCache = new Map<string, Question[]>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

interface Envelope {
  questions?: Question[];
  data?: Question[];
  metadata?: {
    hasMore?: boolean;
    has_more?: boolean;
    total?: number;
    limit?: number;
    offset?: number;
  };
}
type Page = Question[] | Envelope;

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(res: Response | null, attempt: number): number {
  if (res?.status === 429) {
    const raw = res.headers.get("Retry-After") ?? res.headers.get("X-RateLimit-Reset");
    const fromHeader = Number(raw);
    if (Number.isFinite(fromHeader) && fromHeader >= 0) {
      // A API ENEM documenta esses cabeçalhos em milissegundos.
      return Math.min(10_500, Math.max(50, fromHeader + 50));
    }
  }
  return Math.min(4000, 500 * 2 ** attempt);
}

async function fetchPage(
  year: number,
  lang: string,
  limit: number,
  offset: number,
): Promise<Page> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (year !== 2009 && lang) params.set("language", lang);

  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(`${API_BASE}/exams/${year}/questions?${params}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (res.ok) return (await res.json()) as Page;

      const message = await readErrorResponse(res);
      if (!isRetryableStatus(res.status) || attempt === MAX_REQUEST_ATTEMPTS - 1) {
        const error: ApiError = new Error(
          `HTTP ${res.status}${message ? `: ${message}` : ""}`,
        );
        error.status = res.status;
        throw error;
      }

      await sleep(retryDelayMs(res, attempt));
    } catch (error) {
      if ((error as ApiError)?.status) throw error;
      lastNetworkError = error;
      if (attempt === MAX_REQUEST_ATTEMPTS - 1) {
        throw new Error("Falha de rede/CORS ao consultar a API ENEM.");
      }
      await sleep(retryDelayMs(res, attempt));
    }
  }

  throw new Error(
    lastNetworkError
      ? "Falha de rede/CORS ao consultar a API ENEM."
      : "Falha ao consultar a API ENEM.",
  );
}

function questionsFromPage(page: Page): Question[] {
  const questions = Array.isArray(page) ? page : page.questions ?? page.data ?? [];
  if (!Array.isArray(questions)) {
    throw new Error("Resposta inválida da API ENEM: lista de questões ausente.");
  }

  for (const question of questions) {
    if (
      !question ||
      !Number.isInteger(question.index) ||
      question.index < 1 ||
      !Number.isInteger(question.year)
    ) {
      throw new Error("Resposta inválida da API ENEM: identidade de questão corrompida.");
    }
  }
  return questions;
}

function pageHasMore(page: Page, questions: Question[], offset: number, limit: number): boolean {
  if (Array.isArray(page)) return questions.length >= limit;

  const metadata = page.metadata ?? {};
  if (typeof metadata.hasMore === "boolean") return metadata.hasMore;
  if (typeof metadata.has_more === "boolean") return metadata.has_more;
  if (typeof metadata.total === "number") return offset + limit < metadata.total;
  return questions.length >= limit;
}

export async function fetchExam(
  year: number,
  lang: Language,
  force = false,
): Promise<Question[]> {
  const key = `${year}|${lang}`;
  if (!force && yearCache.has(key)) return yearCache.get(key)!;

  const all: Question[] = [];
  let offset = 0;
  let pageCount = 0;

  while (pageCount < MAX_PAGES) {
    pageCount += 1;
    const page = await fetchPage(year, lang, API_PAGE_LIMIT, offset);
    const questions = questionsFromPage(page);
    all.push(...questions);

    if (!pageHasMore(page, questions, offset, API_PAGE_LIMIT) || questions.length === 0) break;

    // O endpoint trabalha com faixa de índice e limite inclusivo. Avançar pelo
    // tamanho recebido pode repetir/pular posições quando existe sobreposição
    // de borda ou variação de idioma.
    offset += API_PAGE_LIMIT;
    await sleep(PAGE_INTERVAL_MS);
  }

  if (pageCount >= MAX_PAGES) {
    const lastOffset = offset;
    const highestIndex = all.reduce((max, question) => Math.max(max, question.index), 0);
    // Uma prova ENEM conhecida cabe muito abaixo desse teto. Se ainda parecia
    // haver página, falhamos alto em vez de retornar banco truncado.
    if (highestIndex > 0 && lastOffset >= API_PAGE_LIMIT * MAX_PAGES) {
      throw new Error("Paginação da API ENEM excedeu o limite de segurança.");
    }
  }

  const byIdentity = new Map<string, Question>();
  for (const question of all) {
    const identity = `${question.index}|${question.language ?? ""}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, question);
  }

  const questions = [...byIdentity.values()].sort(
    (a, b) =>
      a.index - b.index ||
      String(a.language ?? "").localeCompare(String(b.language ?? "")),
  );

  if (!questions.length) throw new Error("Nenhuma questão retornada pela API ENEM.");
  yearCache.set(key, questions);
  return questions;
}

// ---- Montagem de provas ----
export function sample<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

export function dedupeByIndex(all: Question[], lang: string): Question[] {
  const by = new Map<number, Question>();
  [...all]
    .sort((a, b) => a.index - b.index)
    .forEach((question) => {
      if (!by.has(question.index) || question.language === lang) by.set(question.index, question);
    });
  return [...by.values()].sort((a, b) => a.index - b.index);
}

export function buildRealDay(all: Question[], day: 1 | 2, lang: string): Question[] {
  const wanted =
    day === 1
      ? new Set(["linguagens", "ciencias-humanas"])
      : new Set(["ciencias-natureza", "matematica"]);
  return dedupeByIndex(all.filter((question) => wanted.has(discipline(question))), lang).slice(0, 90);
}

export async function buildUnseenAcrossYears(
  lang: Language,
  seenKeys: Set<string>,
  n = 90,
): Promise<Question[]> {
  const collected: Question[] = [];
  const wantedAreas = ["linguagens", "ciencias-humanas", "ciencias-natureza", "matematica"];
  const quota = Math.ceil(n / 4);
  const per: Record<string, number> = {};

  for (const year of [2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]) {
    let all: Question[];
    try {
      all = await fetchExam(year, lang);
    } catch {
      continue;
    }

    for (const area of wantedAreas) {
      per[area] ??= 0;
      if (per[area] >= quota) continue;

      const pool = all.filter(
        (question) =>
          discipline(question) === area &&
          isQuestionUsableForPractice(question) &&
          !seenKeys.has(questionKey(question)) &&
          !collected.some((candidate) => questionKey(candidate) === questionKey(question)),
      );
      const need = Math.min(quota - per[area], n - collected.length);
      const chosen = sample(pool, need);
      collected.push(...chosen);
      per[area] += chosen.length;
    }

    if (collected.length >= n) break;
  }

  return collected.slice(0, n);
}
