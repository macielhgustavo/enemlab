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
    return current ? `${current.questions.length} questões locais carregadas.` : "Nenhum bundle local carregado.";
  });
  const [error, setError] = useState("");

  async function onFile(file: File | null) {
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const count = importLocalNativeBundle(text);
      setStatus(`${count} questões locais importadas. Reabra o treino/banco para aplicar o overlay.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao importar o bundle local.");
    }
  }

  function clear() {
    clearLocalNativeBundle();
    setError("");
    setStatus("Nenhum bundle local carregado.");
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-neutral-500">Dados · conteúdo nativo local</p>
        <h1 className="text-3xl font-semibold">Importar bundle local</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          O arquivo fica somente neste navegador. Ele não entra no banco principal, backup ou sync do Studium.
          O gabarito continua vindo do provider validado: o bundle local só preenche enunciado e alternativas.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="font-semibold">Primeiro alvo: UNESP 2026</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-neutral-500">Questões esperadas</dt><dd>{UNESP_2026_LOCAL_NATIVE_TARGET.expectedQuestions}</dd></div>
          <div><dt className="text-neutral-500">Alternativas</dt><dd>{UNESP_2026_LOCAL_NATIVE_TARGET.optionIds.join("–")}</dd></div>
          <div><dt className="text-neutral-500">Publicação</dt><dd>Somente local</dd></div>
          <div><dt className="text-neutral-500">SHA da prova revisada</dt><dd className="break-all font-mono text-xs">{UNESP_2026_LOCAL_NATIVE_TARGET.source.sha256}</dd></div>
        </dl>
      </section>

      <section className="space-y-4 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <label className="block space-y-2">
          <span className="font-medium">Bundle JSON</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm"
          />
        </label>
        <p role="status" className="text-sm">{status}</p>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        <button
          type="button"
          onClick={clear}
          className="w-fit rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          Remover conteúdo local
        </button>
      </section>

      <section className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">Contrato de segurança</h2>
        <p>
          Provider, edição, fase, número e letras das alternativas precisam coincidir exatamente com a questão já
          cadastrada. Um bundle não pode fornecer nem substituir a alternativa correta; divergências são rejeitadas.
        </p>
      </section>
    </main>
  );
}
