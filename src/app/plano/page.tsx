"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { pct } from "@/lib/format";
import { AREA_LABELS, AREA_ORDER } from "@/lib/domain/constants";
import { areaStats, weakestContents, wilsonInterval } from "@/lib/domain/stats";
import { dueSRS } from "@/lib/domain/srs";
import {
  buildDueReviewsAttempt,
  buildContentSprintAttempt,
  buildTrainingAttempt,
} from "@/lib/services/attempts";
import { Card } from "@/components/ui";
import type { Attempt } from "@/lib/domain/types";

const BUDGET_KEY = "enem_lab_daily_budget";

export default function PlanoPage() {
  const db = useStore((s) => s.db);
  const addAttempt = useStore((s) => s.addAttempt);
  const router = useRouter();
  const hydrated = useHydrated();
  const [budget, setBudget] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(BUDGET_KEY));
      if (v > 0) setBudget(v);
    } catch {
      /* noop */
    }
  }, []);

  function changeBudget(v: number) {
    setBudget(v);
    try {
      localStorage.setItem(BUDGET_KEY, String(v));
    } catch {
      /* noop */
    }
  }

  async function run(builder: () => Promise<Attempt>) {
    setBusy(true);
    setErr("");
    try {
      const a = await builder();
      addAttempt(a);
      router.push(`/exam/${a.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  const due = dueSRS(db);
  const weak = weakestContents(db, 4);
  const stats = areaStats(db);

  // Prontidão por área (banda de Wilson: garantido = limite inferior).
  const readiness = AREA_ORDER.map((a) => {
    const v = stats[a] || { c: 0, t: 0 };
    const ci = wilsonInterval(v.c, v.t);
    return { area: a, ...v, low: ci.low, high: ci.high, p: v.t ? pct(v.c, v.t) : null };
  });

  // Blocos do plano na ordem: retenção → conteúdos frágeis → volume novo.
  const blocks: { key: number; questions: number }[] = [];
  if (due.length) blocks.push({ key: 0, questions: Math.min(due.length, 30) });
  weak.forEach((_, i) => blocks.push({ key: 1 + i, questions: 15 }));
  blocks.push({ key: 99, questions: 15 });
  const totalQ = blocks.reduce((s, b) => s + b.questions, 0);
  const days = Math.max(1, Math.ceil(totalQ / Math.max(1, budget)));

  return (
    <>
      <Card className="hero glow">
        <span className="pill">Plano de estudo</span>
        <h1 style={{ fontSize: "clamp(32px,4vw,50px)" }}>
          Um caminho ordenado, não uma pilha de questões.
        </h1>
        <p>
          O plano prioriza retenção (revisões vencidas), depois seus conteúdos mais frágeis
          por confiança estatística, e por fim volume inédito para ampliar a amostra.
        </p>
        <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
          <div style={{ maxWidth: 200 }}>
            <label>Orçamento diário (questões)</label>
            <input
              type="number"
              min={5}
              max={200}
              value={budget}
              onChange={(e) => changeBudget(Number(e.target.value))}
            />
          </div>
          <div className="notice" style={{ flex: 1, minWidth: 220 }}>
            Plano de hoje: <b>{totalQ}</b> questões em <b>{blocks.length}</b> blocos • no seu
            ritmo, ~<b>{days}</b> dia(s).
          </div>
        </div>
        {(busy || err) && (
          <div className="notice" style={{ marginTop: 12 }}>
            {busy && <span className="loader" style={{ display: "inline-block", marginRight: 8 }} />}
            {busy ? "Montando bloco…" : err}
          </div>
        )}
      </Card>

      <Card style={{ marginTop: 14 }}>
        <h2>Prontidão por área</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Faixa de Wilson (95%): o limite inferior é o desempenho que você já sustenta com
          confiança; o superior é o teto plausível com a amostra atual.
        </div>
        {readiness.map((r) => (
          <div key={r.area} style={{ margin: "12px 0" }}>
            <div className="row between" style={{ fontSize: 13, marginBottom: 4 }}>
              <b>{AREA_LABELS[r.area]}</b>
              <span className="muted">
                {r.p === null
                  ? "sem amostra"
                  : `garantido ${r.low}% • possível ${r.high}% • n=${r.t}`}
              </span>
            </div>
            <div className="ciBar">
              {r.t > 0 && (
                <span
                  className="range"
                  style={{ left: `${r.low}%`, width: `${Math.max(2, r.high - r.low)}%` }}
                />
              )}
            </div>
          </div>
        ))}
      </Card>

      <Card style={{ marginTop: 14 }}>
        <h2>Seu plano para hoje</h2>
        <div className="queue" style={{ marginTop: 10 }}>
          <div className="studyBlock">
            <div className="prio">1 · retenção</div>
            <h3>
              {due.length ? `${due.length} revisão(ões) vencida(s)` : "Nenhuma revisão vencida"}
            </h3>
            <div className="muted">
              Consolidar o que já foi visto rende mais que volume novo. Comece por aqui.
            </div>
            {due.length > 0 && (
              <button
                className="btn secondary"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => run(() => buildDueReviewsAttempt(db, 30))}
              >
                Revisar agora
              </button>
            )}
          </div>

          {weak.map((w) => (
            <div className="studyBlock" key={w.name}>
              <div className="prio">2 · conteúdo frágil</div>
              <h3>
                {w.name} — {w.p}%
              </h3>
              <div className="muted">
                {w.c}/{w.t} acertos • IC95% {wilsonInterval(w.c, w.t).low}–
                {wilsonInterval(w.c, w.t).high}%. Um sprint focado aqui move o ponteiro.
              </div>
              <button
                className="btn secondary"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => run(() => buildContentSprintAttempt(w.name))}
              >
                Treinar {w.name}
              </button>
            </div>
          ))}

          <div className="studyBlock">
            <div className="prio">3 · volume novo</div>
            <h3>Questões inéditas</h3>
            <div className="muted">
              Amplia a amostra e expõe conteúdos ainda não medidos, alimentando o mapa de
              domínio e o motor adaptativo.
            </div>
            <button
              className="btn secondary"
              style={{ marginTop: 10 }}
              disabled={busy}
              onClick={() =>
                run(() =>
                  buildTrainingAttempt(db, {
                    year: 2023,
                    lang: "ingles",
                    mode: "unseen15",
                    area: "all",
                    minutes: 50,
                    strict: false,
                    strategy: false,
                    alerts: true,
                  }),
                )
              }
            >
              Nunca vi — 15
            </button>
          </div>
        </div>
      </Card>
    </>
  );
}
