import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { IngestionExtractionContext } from "../../ingestion/types";

export interface UfprPythonPayloadLoaderOptions {
  pythonExecutable?: string;
  scriptPath?: string;
  timeoutMs?: number;
}

interface PhysicalObjectiveDocument {
  url: string;
  sha256: string;
  bytes: Uint8Array;
}

function objectiveDocument(context: IngestionExtractionContext): PhysicalObjectiveDocument {
  const byUrl = new Map<string, PhysicalObjectiveDocument>();

  for (const document of context.documents) {
    if (document.definition.role !== "objective-exam") continue;
    const current: PhysicalObjectiveDocument = {
      url: document.fingerprint.url,
      sha256: document.fingerprint.sha256.toLowerCase(),
      bytes: document.fetched.bytes,
    };
    const previous = byUrl.get(current.url);
    if (previous && previous.sha256 !== current.sha256) {
      throw new Error(`UFPR context has conflicting SHA-256 for ${current.url}`);
    }
    if (!previous) byUrl.set(current.url, current);
  }

  if (byUrl.size !== 1) {
    throw new Error(
      `UFPR extractor requires exactly one physical objective PDF, got ${byUrl.size}`,
    );
  }
  return [...byUrl.values()][0];
}

function runPython(
  executable: string,
  args: string[],
  stdin: Uint8Array,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const errorText = Buffer.concat(stderr).toString("utf8").trim();
      if (timedOut) {
        reject(new Error(`UFPR Python extractor timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `UFPR Python extractor exited ${code ?? "without code"}${errorText ? `: ${errorText}` : ""}`,
          ),
        );
        return;
      }
      resolvePromise(Buffer.concat(stdout).toString("utf8"));
    });

    child.stdin.end(Buffer.from(stdin));
  });
}

/**
 * Bridges the SHA-bound IngestionExtractionContext to the deterministic Python
 * PDF parser. The Python process receives exactly one already-acquired official
 * booklet through stdin; it never downloads URLs on its own.
 */
export function createUfprPythonPayloadLoader(
  options: UfprPythonPayloadLoaderOptions = {},
): (context: IngestionExtractionContext) => Promise<unknown> {
  const executable = options.pythonExecutable ?? process.env.PYTHON ?? "python";
  const scriptPath = resolve(options.scriptPath ?? "scripts/extract-ufpr-questions.py");
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error("UFPR Python extractor timeout must be positive");
  }

  return async (context) => {
    const document = objectiveDocument(context);
    const output = await runPython(
      executable,
      [
        scriptPath,
        "--edition-id",
        context.plan.editionId,
        "--year",
        String(context.plan.year),
        "--phase",
        context.plan.phase,
        "--variant",
        context.plan.variant ?? "english",
        "--expected-count",
        String(context.plan.expectedCount),
        "--source-url",
        document.url,
        "--sha256",
        document.sha256,
      ],
      document.bytes,
      timeoutMs,
    );

    try {
      return JSON.parse(output) as unknown;
    } catch (error) {
      throw new Error(
        `UFPR Python extractor returned invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}
