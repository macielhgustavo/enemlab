"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { AREA_LABELS } from "@/lib/domain/constants";
import { allSrs, dueSRS } from "@/lib/domain/srs";
import { buildDueReviewsAttempt, buildActiveRecallAttempt } from "@/lib/services/attempts";
import { Metric, Empty, Card } from "@/components/ui";

export default function SrsPage() {
  const db = useStore((s) => s.db);
  const addAttempt = useStore((s) => s.addAttempt);
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function review(limit: number) {
    setBusy(true);
    setErr("");
    try {
      const a = await buildDueReviewsAttempt(db, limit);
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

  const all = allSrs(db);
  const due = dueSRS(db);
  const now = Date.now();
  const soon = all.filter(
    (x) => +new Date(x.due) > now && +new Date(x.due) <= now + 3 * 86400000,
  );
  const maxInterval = Math.max(0, ...all.map((x) => x.interval || 0));

  return (
    <>
      <Card className="hero">
        <span className="pill">Revisão espaçada</span>
        <h1 style={{ fontSize: "clamp(32px,4vw,50px)" }}>
          Errar uma vez não encerra a questão.
        </h1>
        <p>
          Questões erradas entram na fila. Quando você acerta na revisão, o intervalo
          aumenta. Se errar de novo, ela volta mais cedo.
        </p>
        <div className="row">
          <button className="btn" onClick={() => review(30)} disabled={busy || due.length === 0}>
            Revisar vencidas
          </button>
          <button
            className="btn secondary"
            onClick={() => review(15)}
            disabled={busy || due.length === 0}
          >
            Bloco de até 15
          </button>
        </div>
        {(busy || err) && (
          <div className="notice" style={{ marginTop: 12 }}>
            {busy && (
              <span className="loader" style={{ display: "inline-block", marginRight: 8 }} />
            )}
            {busy ? "Montando bloco de revisão…" : err}
          </div>
        )}
      </Card>

      <div className="grid grid4" style={{ marginTop: 14 }}>
        <Metric label="Vencidas" value={due.length} />
        <Metric label="Próx. 3 dias" value={soon.length} />
        <Metric label="No sistema" value={all.length} />
        <Metric label="Maior intervalo" value={`${maxInterval}d`} />
      </div>

      <Card style={{ marginTop: 14 }}>
        <h2>Fila</h2>
        <div className="srsList">
          {all.length === 0 && <Empty>Erre uma questão para iniciar a fila.</Empty>}
          {all.slice(0, 40).map((x) => {
            const delta = (+new Date(x.due) - now) / 86400000;
            const cls = delta <= 0 ? "" : delta <= 3 ? "soon" : "later";
            return (
              <div className="srsItem" key={x.key}>
                <span className={`dueDot ${cls}`} />
                <div>
                  <b>
                    {x.content || AREA_LABELS[x.area] || x.area} • Q{x.index}
                  </b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    ENEM {x.year} • repetições {x.reps || 0} • intervalo {x.interval || 0}d •{" "}
                    {delta <= 0 ? "vencida" : `em ${Math.ceil(delta)}d`}
                  </div>
                </div>
                <button
                  className="btn secondary"
                  onClick={() => recall(x.key)}
                  disabled={busy}
                >
                  Recordar
                </button>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
