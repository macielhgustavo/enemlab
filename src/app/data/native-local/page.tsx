"use client";

import { useState } from "react";
import {
  clearLocalNativeBundle,
  importLocalNativeBundle,
  loadLocalNativeBundle,
} from "@/lib/native/localDraft";
import { UNESP_2026_LOCAL_NATIVE_TARGET } from "@/lib/native/manifests";

export default function NativeLocalPage() {
  const [status, setStatus] = useState(() => {
    if (typeof window === "undefined") return "";
    const current = loadLocalNativeBundle();
    return current
      ? `${current.questions.length} questões privadas carregadas neste navegador.`
      : "Nenhum conteúdo privado importado neste navegador.";
  });
  const [error, setError] = useState("");

  async function onFile(file: File | null) {
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const count = importLocalNativeBundle(text);
      setStatus(`${count} questões importadas. Reabra o treino/banco para aplicar o conteúdo.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao importar o conteúdo privado.");
    }
  }

  function clear() {
    clearLocalNativeBundle();
    setError("");
    setStatus("Nenhum conteúdo privado importado neste navegador.");
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-neutral-500">Dados · conteúdo privado</p>
        <h1 className="text-3xl font-semibold">Conteúdo nativo do Studium</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          O GitHub mantém identidade, gabarito e proveniência. O texto integral que vocês importarem fica neste
          navegador e é aplicado automaticamente ao Banco e aos treinos. O gabarito continua vindo do provider
          validado e não pode ser sobrescrito pelo arquivo importado.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="font-semibold">Sprint 2 · UNESP 2026</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-neutral-500">Questões esperadas</dt>
            <dd>{UNESP_2026_LOCAL_NATIVE_TARGET.expectedQuestions}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Alternativas</dt>
            <dd>{UNESP_2026_LOCAL_NATIVE_TARGET.optionIds.join("–")}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Armazenamento</dt>
            <dd>Navegador privado</dd>
          </div>
          <div>
            <dt className="text-neutral-500">SHA da prova revisada</dt>
            <dd className="break-all font-mono text-xs">{UNESP_2026_LOCAL_NATIVE_TARGET.source.sha256}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
          Mesmo sem importar JSON, a UNESP 2026 já usa o leitor interno do Studium e abre o PDF na página exata da
          questão. O bundle privado serve para preencher enunciado e alternativas como texto pesquisável.
        </p>
      </section>

      <section className="space-y-4 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <label className="block space-y-2">
          <span className="font-medium">Bundle JSON privado</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </label>
        <p role="status" className="text-sm">{status}</p>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={clear}
          className="w-fit rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          Limpar conteúdo privado
        </button>
      </section>

      <section className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Integridade</h2>
        <p>
          Provider, edição, fase, número e letras das alternativas precisam coincidir exatamente com a questão já
          cadastrada. O arquivo privado preenche conteúdo; ele nunca fornece nem substitui a alternativa correta.
        </p>
      </section>
    </main>
  );
}
