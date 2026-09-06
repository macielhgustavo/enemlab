"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { useActiveProvider } from "@/components/ExamSwitch";
import { sameProvider } from "@/lib/providers";
import { REASONS } from "@/lib/domain/constants";
import { areaLabel } from "@/lib/providers/taxonomy";
import { shortSec } from "@/lib/format";
import { parseManualTags } from "@/lib/domain/stats";
import { buildRetryAttempt } from "@/lib/services/attempts";
import { Card, Empty } from "@/components/ui";
import type { KnewChoice } from "@/lib/domain/types";

const KNEW: { v: KnewChoice; label: string }[] = [
  { v: "sabia", label: "Eu sabia" },
  { v: "quase", label: "Quase sabia" },
  { v: "nao", label: "Não sabia" },
  { v: "pressa", label: "Foi pressa" },
];

export default function ReviewPage() {
  const db = useStore((s) => s.db);
  const mutate = useStore((s) => s.mutate);
  const addAttempt = useStore((s) => s.addAttempt);
  const router = useRouter();
  const hydrated = useHydrated();
  const [filter, setFilter] = useState("all");
  const { providerId } = useActiveProvider();

  function saveNote(nk: string, field: "reason" | "tags" | "text" | "knew", value: string) {
    mutate((d) => {
      const n = (d.notes[nk] ??= { reason: "", tag: "", tags: "", text: "", knew: "" });
      if (field === "tags") {
        n.tags = value;
        n.tag = (value.split(/[;,]/)[0] || "").trim();
      } else {
        (n as Record<string, string>)[field] = value;
      }
    });
  }

  function retrySingle(attemptId: string, key: string) {
    const src = db.attempts.find((x) => x.id === attemptId);
    const row = src?.result?.rows.find((x) => x.key === key);
    if (src && row) {
      const a = buildRetryAttempt(src, [row]);
      addAttempt(a);
      router.push(`/exam/${a.id}`);
    }
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  // Caderno de erros respeita a prova ativa: um erro do ITA nunca aparece
  // como se fosse do ENEM.
  const items = db.attempts
    .filter((a) => a.result && sameProvider(a.providerId, providerId))
    .flatMap((a) =>
      a.result!.rows
        .filter((r) => r.isCorrect === false)
        .filter((r) => {
          if (filter === "certeza") return r.confidence === "certeza";
          if (filter === "slow") return r.timeSec > 180;
          return true;
        })
        .map((r) => ({ a, r, nk: `${a.id}|${r.key}` })),
    );

  return (
    <Card>
      <div className="row between">
        <div>
          <h2>Caderno de erros</h2>
          <div className="muted">
            Classifique o motivo para o radar aprender onde você perde pontos.
          </div>
        </div>
        <select
          style={{ maxWidth: 220 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Todos</option>
          <option value="certeza">Erros com certeza</option>
          <option value="slow">Erros lentos</option>
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        {items.length === 0 && <Empty>Nenhum erro neste filtro.</Empty>}
        {items.map(({ a, r, nk }) => {
          const note = db.notes[nk] || {};
          const tags = parseManualTags(note).length
            ? parseManualTags(note)
            : r.tags?.length
              ? r.tags
              : [r.content];
          return (
            <div className="card" style={{ boxShadow: "none", margin: "8px 0" }} key={nk}>
              <div className="row between">
                <div>
                  <b>
                    ENEM {a.year} • questão {r.index}
                  </b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {areaLabel(r.area, providerId)} • {r.selected || "—"} → {r.correct} •{" "}
                    {r.confidence || "sem confiança"} • {shortSec(r.timeSec)}
                  </div>
                  <div className="multiTags">
                    {tags.map((t) => (
                      <span className="multiTag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="row">
                  <a className="btn secondary link-btn" href={`/result/${a.id}`}>
                    Ver questão
                  </a>
                  <button className="btn secondary" onClick={() => retrySingle(a.id, r.key)}>
                    Refazer
                  </button>
                </div>
              </div>

              <div className="reviewChoice">
                {KNEW.map((c) => (
                  <button
                    key={c.v}
                    className={note.knew === c.v ? "selected" : ""}
                    onClick={() => saveNote(nk, "knew", c.v)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className="grid grid3" style={{ marginTop: 10 }}>
                <div>
                  <label>Motivo</label>
                  <select
                    value={note.reason || ""}
                    onChange={(e) => saveNote(nk, "reason", e.target.value)}
                  >
                    <option value="">Não classificado</option>
                    {REASONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Conteúdos (separe por ;)</label>
                  <input
                    defaultValue={note.tags || note.tag || tags.join("; ")}
                    onBlur={(e) => saveNote(nk, "tags", e.target.value)}
                  />
                </div>
                <div>
                  <label>Nota</label>
                  <input
                    defaultValue={note.text || ""}
                    placeholder="O que revisar?"
                    onBlur={(e) => saveNote(nk, "text", e.target.value)}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
