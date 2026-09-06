"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { useActiveProvider } from "@/components/ExamSwitch";
import { areaLabel } from "@/lib/providers/taxonomy";
import { allSrs, dueSRS } from "@/lib/domain/srs";
import { buildDueReviewsAttempt, buildActiveRecallAttempt } from "@/lib/services/attempts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { MetricCard } from "@/components/enem-lab/MetricCard";
import { EmptyState, InlineNotice } from "@/components/enem-lab/states";
import { examLabel } from "@/lib/providers/label";

export default function SrsPage() {
  const db = useStore((s) => s.db);
  const addAttempt = useStore((s) => s.addAttempt);
  const router = useRouter();
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Relógio como estado explícito: mantém a renderização pura e faz a
  // fila se atualizar sozinha conforme os itens vencem.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  async function review(limit: number) {
    setBusy(true);
    setErr("");
    try {
      const a = await buildDueReviewsAttempt(db, limit, providerId);
      addAttempt(a);
      router.push(`/exam/${a.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  async function recall(key: string) {
    setBusy(true);
    setErr("");
    try {
      const a = await buildActiveRecallAttempt(db, key);
      addAttempt(a);
      router.push(`/exam/${a.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  const all = allSrs(db, providerId);
  const due = dueSRS(db, providerId);
  const soon = all.filter(
    (x) => +new Date(x.due) > now && +new Date(x.due) <= now + 3 * 86400000,
  );
  const maxInterval = Math.max(0, ...all.map((x) => x.interval || 0));

  return (
    <>
      <PageHeader
        eyebrow="Módulo · revisões"
        title="Revisão espaçada"
        context={<Badge variant="accent">{examLabel(providerId)}</Badge>}
        description="Errar uma vez não encerra a questão: ela volta na hora certa."
        meta={<span>{all.length} itens na fila</span>}
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={due.length === 0}
              onClick={() => review(30)}
            >
              Revisar vencidas
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || due.length === 0}
              onClick={() => review(15)}
            >
              Bloco de 15
            </Button>
          </>
        }
      />

      {err && (
        <div style={{ marginBottom: 16 }}>
          <InlineNotice tone="danger">{err}</InlineNotice>
        </div>
      )}

      <div className="el-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(180px,100%),1fr))", gap: "var(--density-gap)" }}>
        <MetricCard label="Vencidas" value={due.length} tone={due.length > 0 ? "warning" : "default"} />
        <MetricCard label="Próx. 3 dias" value={soon.length} />
        <MetricCard label="No sistema" value={all.length} />
        <MetricCard
          label="Maior intervalo"
          value={all.length ? maxInterval : null}
          unit="d"
          hint={all.length ? undefined : "sem itens ainda"}
        />
      </div>

      <Card style={{ marginTop: "var(--density-gap)" }}>
        <h2 className="heading-md">Fila</h2>
        <div className="el-srslist">
          {all.length === 0 ? (
            <EmptyState
              title="A fila está vazia"
              description="Erre uma questão num treino e ela entra aqui para voltar na hora certa."
            />
          ) : (
            all.slice(0, 40).map((x) => {
              const delta = (+new Date(x.due) - now) / 86400000;
              const vencida = delta <= 0;
              const tom = vencida ? "danger" : delta <= 3 ? "warning" : "neutral";
              return (
                <Card key={x.key} padding="sm" className="el-srsitem">
                  <div className="el-srsitem__body">
                    <b className="heading-sm">
                      {x.content || areaLabel(x.area, providerId)} • Q{x.index}
                    </b>
                    <div className="caption el-srsitem__meta">
                      {/* A banca vem do item, não de um padrão: um item do ITA
                          dizia "ENEM 2026" aqui. */}
                      <span>
                        {examLabel(x.providerId ?? providerId)} {x.year}
                      </span>
                      <span>{x.reps || 0} repetições</span>
                      <span>intervalo {x.interval || 0}d</span>
                    </div>
                  </div>
                  <Badge variant={tom}>
                    {vencida ? "vencida" : `em ${Math.ceil(delta)}d`}
                  </Badge>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => recall(x.key)}>
                    Recordar
                  </Button>
                </Card>
              );
            })
          )}
        </div>
      </Card>
    </>
  );
}
