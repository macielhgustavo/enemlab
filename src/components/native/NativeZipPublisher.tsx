"use client";

import { useState } from "react";
import { ensureFreshSession, loadSession } from "@/lib/cloud/client";
import { publishNativePack } from "@/lib/native/cloud";
import {
  approveAllStructurallyValid,
  nativePackGate,
  parseNativePackJson,
} from "@/lib/native/review";
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

function pageFilename(page: number): string {
  return `page-${String(page).padStart(3, "0")}.webp`;
}

function gateMessage(pack: NativePack): string {
  const gate = nativePackGate(pack);
  if (gate.publishable) return "";
  const preview = gate.issues
    .slice(0, 5)
    .map((row) => `${row.questionKey}: ${row.issues.join(", ")}`)
    .join(" • ");
  const suffix = gate.issues.length > 5 ? ` • +${gate.issues.length - 5} pendências` : "";
  return `NativePack bloqueado (${gate.published}/${gate.total} prontas). ${preview}${suffix}`;
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
      const parsed = parseNativePackJson(new TextDecoder().decode(manifestBytes));
      // Itens sem qualquer pendência estrutural/extração são aprovados em massa.
      // Só exceções reais permanecem para revisão humana.
      const nextPack = approveAllStructurallyValid(parsed);
      const gate = nativePackGate(nextPack);
      if (!gate.publishable) throw new Error(gateMessage(nextPack));

      // O publisher só precisa das páginas canônicas; crops antigos dentro do
      // ZIP não entram na contagem nem são reextraídos para memória.
      const pageEntries = entries.filter((entry) => /(^|\/)page-\d{3}\.webp$/i.test(entry.name));
      const entriesByName = new Map(pageEntries.map((entry) => [baseName(entry.name), entry]));
      const expectedNames = new Set<string>();
      for (const document of nextPack.documents) {
        for (let page = 1; page <= document.pageCount; page += 1) expectedNames.add(pageFilename(page));
      }
      const missing = [...expectedNames].filter((name) => !entriesByName.has(name));
      if (missing.length) {
        const preview = missing.slice(0, 8).join(", ");
        throw new Error(
          `Pacote incompleto: faltam ${missing.length} página(s) (${preview}${missing.length > 8 ? ", …" : ""}).`,
        );
      }

      const nextPages = new Map<string, File>();
      await Promise.all(
        [...expectedNames].map(async (filename) => {
          const entry = entriesByName.get(filename)!;
          const bytes = await extractZipEntry(buffer, entry);
          nextPages.set(filename, new File([bytes.buffer as ArrayBuffer], filename, { type: "image/webp" }));
        }),
      );

      setPack(nextPack);
      setPages(nextPages);
      setMessage(
        `Pacote validado automaticamente: ${gate.total}/${gate.total} questões prontas e ${nextPages.size} páginas. Toque em Publicar ZIP.`,
      );
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
      setMessage(
        `Publicado com sucesso: ${result.uploadedPages} páginas e ${result.uploadedCrops} regiões visuais únicas.`,
      );
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
        <p className="mt-1 text-sm text-neutral-500">
          Selecione o pacote completo. O app valida o NativePack, aprova automaticamente itens seguros e extrai somente as páginas necessárias.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            onChange={(event) => void loadZip(event.target.files?.[0] ?? null)}
          />
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
