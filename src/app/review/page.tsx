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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { FilterChip } from "@/components/enem-lab/FilterBar";
import { EmptyState } from "@/components/enem-lab/states";
import { examLabel } from "@/lib/providers/label";
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
    <>
      <PageHeader
        eyebrow="Módulo · erros"
        title="Caderno de erros"
        context={<Badge variant="accent">{examLabel(providerId)}</Badge>}
        description="Classifique o motivo para o radar aprender onde você perde pontos."
        meta={<span>{items.length} erros neste filtro</span>}
      />

      {/* Três opções cabem como chips à vista; um select as esconderia. */}
      <div className="el-histfilter" role="group" aria-label="Filtrar erros">
        {[
          ["all", "Todos"],
          ["certeza", "Erros com certeza"],
          ["slow", "Erros lentos"],
        ].map(([v, rotulo]) => (
          <FilterChip key={v} active={filter === v} onClick={() => setFilter(v)}>
            {rotulo}
          </FilterChip>
        ))}
      </div>

      <div className="el-stack" style={{ gap: "var(--density-gap)" }}>
        {items.length === 0 && (
          <EmptyState
            title="Nenhum erro neste filtro"
            description="Erros aparecem aqui depois que você corrige um treino."
          />
        )}
        {items.map(({ a, r, nk }) => {
          const note = db.notes[nk] || {};
          const tags = parseManualTags(note).length
            ? parseManualTags(note)
            : r.tags?.length
              ? r.tags
              : [r.content];
          return (
            <Card padding="sm" key={nk}>
              <div className="row between">
                <div>
                  <b className="heading-sm">
                    {/* A banca vem da tentativa: o caderno mistura provas. */}
                    {examLabel(a.providerId)} {a.year} • questão {r.index}
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
                  <Button asChild variant="secondary" size="sm">
                    <a href={`/result/${a.id}`}>Ver questão</a>
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => retrySingle(a.id, r.key)}>
                    Refazer
                  </Button>
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
            </Card>
          );
        })}
      </div>
    </>
  );
}
