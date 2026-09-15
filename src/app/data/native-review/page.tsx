"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NativeCropImage, NativePageWithRegion } from "@/components/native/NativeCrop";
import { ensureFreshSession, loadSession } from "@/lib/cloud/client";
import { publishNativePack } from "@/lib/native/cloud";
import {
  addNativeQuestionRegion,
  approveAllStructurallyValid,
  approveNativeQuestion,
  documentForQuestion,
  nativePackGate,
  nativePageFilename,
  parseNativePackJson,
  removeNativeQuestionRegion,
  updateNativeQuestionRect,
  updateNativeQuestionRegion,
} from "@/lib/native/review";
import { nativePublicationGate, type NativePack, type NativeRect } from "@/lib/native/contracts";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function saveJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function NativeReviewPage() {
  const [pack, setPack] = useState<NativePack | null>(null);
  const [index, setIndex] = useState(0);
  const [regionIndex, setRegionIndex] = useState(0);
  const [pageUrls, setPageUrls] = useState<Record<string, string>>({});
  const [pageFiles, setPageFiles] = useState<Map<string, File>>(new Map());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    return () => Object.values(pageUrls).forEach((url) => URL.revokeObjectURL(url));
  }, [pageUrls]);

  const current = pack?.questions[index] ?? null;
  const documentRecord = pack && current ? documentForQuestion(pack, current) : undefined;
  const region = current?.visualRegions[regionIndex] ?? current?.visualRegions[0] ?? null;
  const filename = documentRecord && region ? nativePageFilename(documentRecord.pageAssetPattern, region.page) : "";
  const pageUrl = filename ? pageUrls[filename] : undefined;
  const questionGate = current ? nativePublicationGate(current, documentRecord) : null;
  const packGate = useMemo(() => (pack ? nativePackGate(pack) : null), [pack]);

  async function loadPack(file: File | null) {
    if (!file) return;
    setError("");
    setMessage("");
    try {
      const next = parseNativePackJson(await file.text());
      setPack(next);
      setIndex(0);
      setRegionIndex(0);
      setMessage(`${next.questions.length} questões carregadas para revisão.`);
    } catch (cause) {
      setPack(null);
      setError(cause instanceof Error ? cause.message : "Falha ao abrir NativePack.");
    }
  }

  function loadPages(files: FileList | null) {
    if (!files) return;
    const nextUrls: Record<string, string> = {};
    const nextFiles = new Map<string, File>();
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith(".webp")) continue;
      nextUrls[file.name] = URL.createObjectURL(file);
      nextFiles.set(file.name, file);
    }
    setPageUrls((previous) => {
      Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
      return nextUrls;
    });
    setPageFiles(nextFiles);
    setMessage(`${nextFiles.size} páginas WebP carregadas.`);
  }

  function updateRect(partial: Partial<NativeRect>) {
    if (!pack || !current || !region) return;
    const nextRect = { ...region.rect, ...partial };
    nextRect.x = clamp(nextRect.x, 0, 0.99);
    nextRect.y = clamp(nextRect.y, 0, 0.99);
    nextRect.width = clamp(nextRect.width, 0.01, 1 - nextRect.x);
    nextRect.height = clamp(nextRect.height, 0.01, 1 - nextRect.y);
    setPack(updateNativeQuestionRect(pack, current.questionKey, regionIndex, nextRect));
    setMessage("Recorte alterado; a aprovação desta questão foi invalidada.");
  }

  function updatePage(page: number) {
    if (!pack || !current || !region || !documentRecord) return;
    const nextPage = Math.round(clamp(page, 1, documentRecord.pageCount));
    setPack(updateNativeQuestionRegion(pack, current.questionKey, regionIndex, { page: nextPage }));
    setMessage("Página da região alterada; a aprovação desta questão foi invalidada.");
  }

  function addRegion() {
    if (!pack || !current || !region) return;
    const proposedX = region.rect.x < 0.5 ? 0.52 : 0.05;
    const width = Math.min(region.rect.width, 1 - proposedX);
    const height = Math.min(region.rect.height, 0.45, 1 - region.rect.y);
    const next = addNativeQuestionRegion(pack, current.questionKey, {
      page: region.page,
      role: "continuation",
      rect: {
        x: proposedX,
        y: region.rect.y,
        width: Math.max(0.01, width),
        height: Math.max(0.01, height),
      },
    });
    setPack(next);
    setRegionIndex(next.questions[index].visualRegions.length - 1);
    setMessage("Nova região adicionada como continuação; ajuste página e coordenadas antes de aprovar.");
  }

  function removeRegion() {
    if (!pack || !current || !region) return;
    try {
      const next = removeNativeQuestionRegion(pack, current.questionKey, regionIndex);
      setPack(next);
      setRegionIndex((value) => Math.max(0, Math.min(value - 1, next.questions[index].visualRegions.length - 1)));
      setError("");
      setMessage("Região removida; a aprovação desta questão foi invalidada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao remover região.");
    }
  }

  function moveQuestion(nextIndex: number) {
    if (!pack) return;
    setIndex(clamp(nextIndex, 0, pack.questions.length - 1));
    setRegionIndex(0);
  }

  function approveCurrent() {
    if (!pack || !current) return;
    try {
      setPack(approveNativeQuestion(pack, current.questionKey));
      setError("");
      setMessage(`Questão ${current.number} aprovada.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao aprovar questão.");
    }
  }

  function approveAll() {
    if (!pack) return;
    const next = approveAllStructurallyValid(pack);
    setPack(next);
    const gate = nativePackGate(next);
    setMessage(`${gate.published}/${gate.total} questões estruturalmente válidas aprovadas.`);
  }

  async function publish() {
    if (!pack || !packGate?.publishable) return;
    setPublishing(true);
    setError("");
    try {
      const stored = loadSession();
      if (!stored) throw new Error("Entre na conta do Studium antes de publicar o corpus privado.");
      const session = await ensureFreshSession(stored);
      const result = await publishNativePack(session, pack, pageFiles);
      setPack(result.pack);
      setMessage(
        `Publicado com sucesso: ${result.uploadedPages} páginas canônicas e ${result.uploadedCrops} recortes de questão.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao publicar NativePack.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-5">
      <header className="space-y-2">
        <p className="text-sm text-neutral-500">Dados · NativePack</p>
        <h1 className="text-3xl font-semibold">Revisão e publicação de prova nativa</h1>
        <p className="max-w-4xl text-sm text-neutral-600 dark:text-neutral-300">
          Carregue o manifest gerado pelo pipeline e as páginas WebP. Uma questão pode ter mais de uma região quando o layout
          atravessa colunas ou páginas. Qualquer alteração invalida a aprovação anterior; só um pack integralmente aprovado pode
          entrar no storage privado.
        </p>
        <div className="flex gap-4 text-sm">
          <Link href="/data" className="underline">Voltar para Dados</Link>
          <Link href="/account" className="underline">Conta / login</Link>
        </div>
      </header>

      <section className="grid gap-4 rounded-2xl border p-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium">1. native-pack.json</span>
          <input type="file" accept="application/json,.json" onChange={(event) => void loadPack(event.target.files?.[0] ?? null)} />
        </label>
        <label className="space-y-2 text-sm">
          <span className="font-medium">2. páginas WebP</span>
          <input type="file" multiple onChange={(event) => loadPages(event.target.files)} />
          <span className="block text-xs text-neutral-500">Abre o seletor de Arquivos do dispositivo. Selecione os arquivos .webp; outros formatos serão ignorados.</span>
        </label>
      </section>

      {message ? <p role="status" className="rounded-xl border p-3 text-sm">{message}</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-red-300 p-3 text-sm text-red-700">{error}</p> : null}

      {!pack || !current || !region ? (
        <section className="rounded-2xl border p-6 text-sm text-neutral-500">Carregue um NativePack para começar.</section>
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
            <div>
              <b>{current.providerId.toUpperCase()} {current.year} · questão {current.number}</b>
              <div className="text-xs text-neutral-500">
                {current.questionKey} · página {region.page} · região {regionIndex + 1}/{current.visualRegions.length} · {current.status}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" disabled={index === 0} onClick={() => moveQuestion(index - 1)}>Anterior</button>
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" disabled={index >= pack.questions.length - 1} onClick={() => moveQuestion(index + 1)}>Próxima</button>
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={approveCurrent}>Aprovar questão</button>
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={approveAll}>Aprovar válidas</button>
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-2 rounded-2xl border p-4 text-sm">
            <span className="font-medium">Regiões:</span>
            {current.visualRegions.map((item, itemIndex) => (
              <button
                key={`${item.page}-${itemIndex}`}
                type="button"
                className={`rounded-lg border px-3 py-2 ${itemIndex === regionIndex ? "font-semibold" : ""}`}
                onClick={() => setRegionIndex(itemIndex)}
              >
                {itemIndex + 1} · pág. {item.page}
              </button>
            ))}
            <button type="button" className="rounded-lg border px-3 py-2" onClick={addRegion}>+ Adicionar região</button>
            <button
              type="button"
              className="rounded-lg border px-3 py-2 disabled:opacity-50"
              disabled={current.visualRegions.length <= 1}
              onClick={removeRegion}
            >
              Remover região
            </button>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3 rounded-2xl border p-4">
              <h2 className="font-semibold">Página completa + região</h2>
              {pageUrl ? (
                <NativePageWithRegion src={pageUrl} rect={region.rect} alt={`Página ${region.page} da prova`} />
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-sm text-neutral-500">Falta o arquivo {filename}.</div>
              )}
            </div>
            <div className="space-y-3 rounded-2xl border p-4">
              <h2 className="font-semibold">Recorte {regionIndex + 1} que será mostrado no runner</h2>
              {pageUrl ? (
                <NativeCropImage src={pageUrl} rect={region.rect} alt={`Questão ${current.number}, região ${regionIndex + 1}`} />
              ) : (
                <div className="rounded-xl border border-dashed p-8 text-sm text-neutral-500">Carregue a página correspondente.</div>
              )}
            </div>
          </section>

          <section className="grid gap-4 rounded-2xl border p-4 md:grid-cols-5">
            <label className="space-y-2 text-sm">
              <span className="font-medium">page: {region.page}</span>
              <input
                type="number"
                min="1"
                max={documentRecord?.pageCount ?? region.page}
                value={region.page}
                onChange={(event) => updatePage(Number(event.target.value))}
                className="w-full rounded-lg border bg-transparent px-2 py-1"
              />
            </label>
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field} className="space-y-2 text-sm">
                <span className="font-medium">{field}: {region.rect[field].toFixed(3)}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.001"
                  value={region.rect[field]}
                  onChange={(event) => updateRect({ [field]: Number(event.target.value) })}
                  className="w-full"
                />
              </label>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border p-4 text-sm">
              <h2 className="font-semibold">Gate da questão</h2>
              <p className="mt-2">{questionGate?.publishable ? "Estruturalmente válida." : "Bloqueada."}</p>
              {questionGate?.issues.length ? <ul className="mt-2 list-disc pl-5">{questionGate.issues.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              {current.extraction.issues.length ? (
                <div className="mt-3 text-neutral-500">Semântica: {current.extraction.issues.join("; ")}</div>
              ) : null}
            </div>
            <div className="rounded-2xl border p-4 text-sm">
              <h2 className="font-semibold">Gate do pack</h2>
              <p className="mt-2">{packGate?.published}/{packGate?.total} aprovadas · {packGate?.publishable ? "pronto para publicar" : "ainda em revisão"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border px-3 py-2 text-sm"
                  onClick={() => saveJson(`${current.providerId}-${current.year}-${current.phase}-native-reviewed.json`, pack)}
                >
                  Exportar revisado
                </button>
                <button
                  type="button"
                  className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={!packGate?.publishable || publishing || pageFiles.size === 0}
                  onClick={() => void publish()}
                >
                  {publishing ? "Publicando…" : "Publicar privado"}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
