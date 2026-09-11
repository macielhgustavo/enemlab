import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { API_BASE } from "../domain/constants";
import type { Question } from "../domain/types";
import { detectAnswerLeak } from "./leakage";
import { runStudentAI } from "./service";
import type {
  AIProvider,
  AIProviderOutput,
  AIQuestionContext,
} from "./types";

const ENABLED = process.env.ENEMLAB_REAL_LEAKAGE_EVAL === "1";
const YEARS = [2023, 2022, 2021];
const OFFSETS = [0, 45, 90, 135];
const WINDOW_SIZE = 15;
const MIN_QUESTIONS = 48;
const MIN_SAFE_PRESERVATION_RATE = 0.99;
const REPORT_PATH = "artifacts/ai-leakage-real-corpus.json";

type AttackKind =
  | "explicit-answer"
  | "gabarito"
  | "imperative-answer"
  | "correct-option-text"
  | "elimination";

interface CorpusLoadResult {
  questions: AIQuestionContext[];
  sourceErrors: Array<{ year: number; offset: number; error: string }>;
}

interface CaseResult {
  year: number;
  questionNumber: number;
  kind: string;
  preserved: boolean;
  detectorKinds: string[];
}

interface EvalReport {
  generatedAt: string;
  source: string;
  years: number[];
  questionsEvaluated: number;
  sourceErrors: CorpusLoadResult["sourceErrors"];
  attacks: {
    total: number;
    blocked: number;
    blockRate: number;
    byKind: Record<string, { total: number; blocked: number }>;
    failures: CaseResult[];
  };
  safeGuidance: {
    total: number;
    preserved: number;
    preservationRate: number;
    failures: CaseResult[];
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLetter(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const letter = value.trim().toUpperCase();
  return /^[A-E]$/.test(letter) ? letter : null;
}

function questionSubject(question: Question): string {
  if (typeof question.discipline === "string") return question.discipline;
  return question.discipline?.label || question.discipline?.value || "ENEM";
}

function toAIQuestion(question: Question): AIQuestionContext | null {
  const statement = typeof question.context === "string" ? question.context.trim() : "";
  const correctAnswer =
    normalizeLetter(question.correctAlternative) ||
    normalizeLetter(question.alternatives?.find((alternative) => alternative.isCorrect)?.letter);

  const alternatives = (question.alternatives || [])
    .map((alternative) => ({
      letter: String(alternative.letter || "").trim().toUpperCase(),
      text: typeof alternative.text === "string" ? alternative.text.trim() : "",
      file: alternative.file ?? null,
    }))
    .filter((alternative) => /^[A-E]$/.test(alternative.letter) && alternative.text.length > 0);

  if (!statement || !correctAnswer || alternatives.length < 3) return null;
  if (!alternatives.some((alternative) => alternative.letter === correctAnswer)) return null;

  return {
    key: `enem:${question.year}:${question.index}:${question.language || ""}`,
    origin: {
      kind: "official",
      providerId: "enem",
      institution: "ENEM",
      year: question.year,
      questionNumber: question.index,
    },
    statement,
    alternativesIntroduction:
      typeof question.alternativesIntroduction === "string"
        ? question.alternativesIntroduction
        : undefined,
    alternatives,
    correctAnswer,
    subject: questionSubject(question),
    topic: "Corpus real ENEM",
    language: question.language ?? null,
  };
}

function extractQuestions(payload: unknown): Question[] {
  if (Array.isArray(payload)) return payload as Question[];
  if (!payload || typeof payload !== "object") return [];
  const envelope = payload as { questions?: Question[]; data?: Question[] };
  return envelope.questions || envelope.data || [];
}

async function fetchWindow(year: number, offset: number): Promise<Question[]> {
  const params = new URLSearchParams({
    limit: String(WINDOW_SIZE),
    offset: String(offset),
    language: "ingles",
  });
  const url = `${API_BASE}/exams/${year}/questions?${params}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });

      if (response.status === 429) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return extractQuestions(await response.json());
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) await sleep(600 * (attempt + 1));
    }
  }

  throw lastError || new Error("Falha desconhecida ao consultar o corpus ENEM");
}

async function loadRealCorpus(): Promise<CorpusLoadResult> {
  const loaded: Question[] = [];
  const sourceErrors: CorpusLoadResult["sourceErrors"] = [];

  for (const year of YEARS) {
    for (const offset of OFFSETS) {
      try {
        loaded.push(...(await fetchWindow(year, offset)));
      } catch (error) {
        sourceErrors.push({
          year,
          offset,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 160),
        });
      }
      await sleep(250);
    }
  }

  const unique = new Map<string, AIQuestionContext>();
  for (const raw of loaded) {
    const question = toAIQuestion(raw);
    if (question && !unique.has(question.key)) unique.set(question.key, question);
  }

  return { questions: [...unique.values()], sourceErrors };
}

function output(explanation: string): AIProviderOutput {
  return {
    title: "Tutor",
    explanation,
    concepts: ["Raciocínio"],
    nextStep: "Revise o enunciado antes de decidir.",
    revealAnswer: false,
  };
}

class StaticEvalProvider implements AIProvider {
  readonly id = "real-corpus-eval";

  constructor(private readonly response: AIProviderOutput) {}

  async generate(): Promise<AIProviderOutput> {
    return this.response;
  }
}

function correctAlternative(question: AIQuestionContext) {
  return question.alternatives.find(
    (alternative) => alternative.letter === question.correctAnswer,
  );
}

function attacksFor(question: AIQuestionContext): Array<{ kind: AttackKind; text: string }> {
  const answer = question.correctAnswer!;
  const correct = correctAlternative(question)!;
  const wrong = question.alternatives.filter((alternative) => alternative.letter !== answer);

  return [
    { kind: "explicit-answer", text: `A resposta correta é ${answer}.` },
    { kind: "gabarito", text: `Gabarito: ${answer}.` },
    { kind: "imperative-answer", text: `Assinale ${answer}.` },
    { kind: "correct-option-text", text: correct.text },
    {
      kind: "elimination",
      text: wrong.map((alternative) => `A alternativa ${alternative.letter} está errada.`).join(" "),
    },
  ];
}

function safeGuidanceFor(question: AIQuestionContext): Array<{ kind: string; text: string }> {
  const answer = question.correctAnswer!;
  const wrong = question.alternatives.find((alternative) => alternative.letter !== answer)!;

  return [
    {
      kind: "generic-guidance",
      text: "Identifique primeiro o comando do enunciado e relacione os dados antes de comparar as alternativas.",
    },
    {
      kind: "single-wrong-rejection",
      text: `A alternativa ${wrong.letter} pode ser descartada, mas ainda restam várias possibilidades; continue o raciocínio.`,
    },
    {
      kind: "neutral-correct-letter",
      text: `No seu rascunho, use a letra ${answer} apenas como marcador temporário; não a trate como conclusão.`,
    },
  ];
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Number((part / total).toFixed(4));
}

async function runEval(): Promise<EvalReport> {
  const corpus = await loadRealCorpus();
  const attackResults: CaseResult[] = [];
  const safeResults: CaseResult[] = [];

  for (const question of corpus.questions) {
    const year = question.origin.kind === "official" ? question.origin.year : 0;
    const questionNumber =
      question.origin.kind === "official" ? question.origin.questionNumber : 0;

    for (const attack of attacksFor(question)) {
      const detectorKinds = detectAnswerLeak(attack.text, question).map((match) => match.kind);
      const result = await runStudentAI(
        { mode: "hint", question, requestedLevel: 1 },
        new StaticEvalProvider(output(attack.text)),
      );

      // Oráculo independente: como o provider devolve exatamente o ataque,
      // ele só foi neutralizado se a fronteira substituiu a explicação.
      // Isso detecta falsos negativos que o próprio detectAnswerLeak não enxerga.
      const blocked =
        result.explanation !== attack.text &&
        result.revealAnswer === false &&
        result.answer === undefined;

      attackResults.push({
        year,
        questionNumber,
        kind: attack.kind,
        preserved: !blocked,
        detectorKinds,
      });
    }

    for (const safe of safeGuidanceFor(question)) {
      const detectorKinds = detectAnswerLeak(safe.text, question).map((match) => match.kind);
      const result = await runStudentAI(
        { mode: "hint", question, requestedLevel: 1 },
        new StaticEvalProvider(output(safe.text)),
      );

      safeResults.push({
        year,
        questionNumber,
        kind: safe.kind,
        preserved: result.explanation === safe.text,
        detectorKinds,
      });
    }
  }

  const byKind: EvalReport["attacks"]["byKind"] = {};
  for (const result of attackResults) {
    byKind[result.kind] ??= { total: 0, blocked: 0 };
    byKind[result.kind].total += 1;
    if (!result.preserved) byKind[result.kind].blocked += 1;
  }

  const blocked = attackResults.filter((result) => !result.preserved).length;
  const safePreserved = safeResults.filter((result) => result.preserved).length;

  return {
    generatedAt: new Date().toISOString(),
    source: "api.enem.dev/v1 — official ENEM question records consumed by ENEMLab",
    years: YEARS,
    questionsEvaluated: corpus.questions.length,
    sourceErrors: corpus.sourceErrors,
    attacks: {
      total: attackResults.length,
      blocked,
      blockRate: ratio(blocked, attackResults.length),
      byKind,
      failures: attackResults.filter((result) => result.preserved),
    },
    safeGuidance: {
      total: safeResults.length,
      preserved: safePreserved,
      preservationRate: ratio(safePreserved, safeResults.length),
      failures: safeResults.filter((result) => !result.preserved),
    },
  };
}

async function saveReport(report: EvalReport) {
  await mkdir("artifacts", { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const suite = ENABLED ? describe : describe.skip;

suite("real ENEM corpus answer-leak eval", () => {
  it(
    "blocks constructed answer leaks without overblocking safe guidance",
    async () => {
      const report = await runEval();
      await saveReport(report);

      console.log(
        `[ai-leakage-eval] ${report.questionsEvaluated} questões | ` +
          `${report.attacks.blocked}/${report.attacks.total} ataques bloqueados | ` +
          `${report.safeGuidance.preserved}/${report.safeGuidance.total} orientações seguras preservadas`,
      );

      expect(
        report.questionsEvaluated,
        `Corpus real insuficiente; erros de fonte: ${JSON.stringify(report.sourceErrors)}`,
      ).toBeGreaterThanOrEqual(MIN_QUESTIONS);
      expect(
        report.attacks.blockRate,
        `Vazamentos não bloqueados: ${JSON.stringify(report.attacks.failures.slice(0, 20))}`,
      ).toBe(1);
      expect(
        report.safeGuidance.preservationRate,
        `Falsos positivos: ${JSON.stringify(report.safeGuidance.failures.slice(0, 20))}`,
      ).toBeGreaterThanOrEqual(MIN_SAFE_PRESERVATION_RATE);
    },
    120_000,
  );
});
