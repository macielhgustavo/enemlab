"use client";

import { useState } from "react";
import { ensureFreshSession, loadSession } from "@/lib/cloud/client";
import { publishNativePack } from "@/lib/native/cloud";
import { nativePackGate, parseNativePackJson } from "@/lib/native/review";
import type { NativePack } from "@/lib/native/contracts";

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

function findEndOfCentralDirectory(view: DataView): number {
  const min = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("ZIP inválido: diretório central não encontrado.");
}

function listZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIP inválido: entrada central corrompida.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function extractZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`ZIP inválido: ${entry.name}.`);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(buffer.slice(start, start + entry.compressedSize));

  if (entry.method === 0) return compressed;
  if (entry.method !== 8) throw new Error(`Compressão ZIP não suportada em ${entry.name}.`);
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador não suporta descompactação ZIP local.");

  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function NativeZipPublisher() {
  const [pack, setPack] = useState<NativePack | null>(null);
  const [pages, setPages] = useState<Map<string, File>>(new Map());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);

  async function loadZip(file: File | null) {
    if (!file) return;
    setError("");
    setMessage("Abrindo pacote…");
    try {
      const buffer = await file.arrayBuffer();
      const entries = listZipEntries(buffer);
      const manifestEntry = entries.find((entry) => /(^|\/)native-pack\.json$/i.test(entry.name));
      if (!manifestEntry) throw new Error("O ZIP não contém native-pack.json.");

      const manifestBytes = await extractZipEntry(buffer, manifestEntry);
      const nextPack = parseNativePackJson(new TextDecoder().decode(manifestBytes));
      const gate = nativePackGate(nextPack);
      if (!gate.publishable) {
        throw new Error(`NativePack ainda não está pronto para publicar (${gate.published}/${gate.total} aprovadas).`);
      }

      const pageEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".webp"));
      const nextPages = new Map<string, File>();
      await Promise.all(
        pageEntries.map(async (entry) => {
          const bytes = await extractZipEntry(buffer, entry);
          const filename = baseName(entry.name);
          nextPages.set(filename, new File([bytes], filename, { type: "image/webp" }));
        }),
      );

      const expectedPages = nextPack.documents.reduce((total, document) => total + document.pageCount, 0);
      if (nextPages.size < expectedPages) {
        throw new Error(`Pacote incompleto: encontrei ${nextPages.size} páginas WebP; esperava ${expectedPages}.`);
      }

      setPack(nextPack);
      setPages(nextPages);
      setMessage(`Pacote pronto: ${nextPack.questions.length} questões e ${nextPages.size} páginas WebP. Agora toque em Publicar ZIP.`);
    } catch (cause) {
      setPack(null);
      setPages(new Map());
      setMessage("");
      setError(cause instanceof Error ? cause.message : "Falha ao abrir o ZIP.");
    }
  }

  async function publishZip() {
    if (!pack || pages.size === 0) return;
    setPublishing(true);
    setError("");
    try {
      const stored = loadSession();
      if (!stored) throw new Error("Entre na conta do Studium antes de publicar.");
      const session = await ensureFreshSession(stored);
      const result = await publishNativePack(session, pack, pages);
      setPack(result.pack);
      setMessage(`Publicado com sucesso: ${result.uploadedPages} páginas e ${result.uploadedCrops} recortes.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao publicar o ZIP.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section className="mx-auto mt-5 w-full max-w-7xl px-5">
      <div className="rounded-2xl border p-4">
        <h2 className="font-semibold">Publicação rápida por ZIP</h2>
        <p className="mt-1 text-sm text-neutral-500">Selecione o pacote completo. O app extrai o native-pack.json e todas as páginas WebP automaticamente.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(event) => void loadZip(event.target.files?.[0] ?? null)} />
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            disabled={!pack || pages.size === 0 || publishing}
            onClick={() => void publishZip()}
          >
            {publishing ? "Publicando…" : "Publicar ZIP"}
          </button>
        </div>
        {message ? <p role="status" className="mt-3 rounded-xl border p-3 text-sm">{message}</p> : null}
        {error ? <p role="alert" className="mt-3 rounded-xl border border-red-300 p-3 text-sm text-red-700">{error}</p> : null}
      </div>
    </section>
  );
}
