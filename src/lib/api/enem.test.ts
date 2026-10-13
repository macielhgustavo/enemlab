import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Question } from "../domain/types";
import { fetchExam } from "./enem";

function question(index: number, year = 2023): Question {
  return {
    index,
    year,
    language: null,
    discipline: index <= 45 ? "linguagens" : "matematica",
    context: `Enunciado completo da questão ${index}.`,
    alternativesIntroduction: "Assinale a alternativa correta.",
    alternatives: ["A", "B", "C", "D", "E"].map((letter) => ({
      letter,
      text: `Alternativa ${letter}`,
      file: null,
      isCorrect: letter === "A",
    })),
    correctAlternative: "A",
    files: [],
  };
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("cliente da API ENEM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pagina por passos de 50 e deduplica a borda inclusiva da API", async () => {
    const offsets: number[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const offset = Number(url.searchParams.get("offset"));
        offsets.push(offset);

        const indexes =
          offset === 0
            ? Array.from({ length: 51 }, (_, i) => i)
                .filter((index) => index > 0)
            : offset === 50
              ? Array.from({ length: 51 }, (_, i) => i + 50)
              : Array.from({ length: 21 }, (_, i) => i + 100);

        return jsonResponse({
          metadata: {
            limit: 50,
            offset,
            total: 120,
            hasMore: offset < 100,
          },
          questions: indexes.map((index) => question(index)),
        });
      }),
    );

    const result = await settle(fetchExam(2023, "ingles", true));

    expect(offsets).toEqual([0, 50, 100]);
    expect(result).toHaveLength(120);
    expect(new Set(result.map((item) => item.index)).size).toBe(120);
    expect(result[0].index).toBe(1);
    expect(result.at(-1)?.index).toBe(120);
  });

  it("respeita Retry-After em 429 e repete a mesma consulta", async () => {
    const requests: string[] = [];
    let call = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requests.push(String(input));
        call += 1;
        if (call === 1) {
          return jsonResponse(
            { error: { message: "Rate limit exceeded" } },
            429,
            { "Retry-After": "25" },
          );
        }
        return jsonResponse({
          metadata: { limit: 50, offset: 0, total: 2, hasMore: false },
          questions: [question(1), question(2)],
        });
      }),
    );

    const result = await settle(fetchExam(2023, "ingles", true));

    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(result.map((item) => item.index)).toEqual([1, 2]);
  });

  it("usa limite 50 e não envia language para 2009", async () => {
    let requested = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requested = String(input);
        return jsonResponse([question(1, 2009)]);
      }),
    );

    const result = await settle(fetchExam(2009, "ingles", true));
    const url = new URL(requested);

    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.has("language")).toBe(false);
    expect(result).toHaveLength(1);
  });
});
