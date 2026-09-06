"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { shortSec } from "@/lib/format";
import { officialRows, weakestContents } from "@/lib/domain/stats";
import { adaptiveCandidates } from "@/lib/domain/adaptive";
import { dueSRS } from "@/lib/domain/srs";
import { buildAdaptiveAttempt } from "@/lib/services/attempts";
import { buildItaAdaptiveAttempt } from "@/lib/services/ita-attempts";
import { useActiveProvider } from "@/components/ExamSwitch";
import { ITA_PROVIDER_ID } from "@/lib/providers";
import { examLabel } from "@/lib/providers/label";
import { Metric, Empty, Card } from "@/components/ui";

export default function AdaptivePage() {
  const db = useStore((s) => s.db);
  const addAttempt = useStore((s) => s.addAttempt);
  const router = useRouter();
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  const isIta = providerId === ITA_PROVIDER_ID;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function generate(n: number) {
    setBusy(true);
    setErr("");
    try {
      // O adaptativo do ITA usa só o histórico do ITA, e só objetivas.
      const a = isIta ? buildItaAdaptiveAttempt(db, n) : await buildAdaptiveAttempt(db, n);
      addAttempt(a);
      router.push(`/exam/${a.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  const cand = adaptiveCandidates(db);
  const weak = weakestContents(db, 4, providerId);
  const due = dueSRS(db, providerId);
  const certezaWrong = officialRows(db).filter(
    (x) => x.isCorrect === false && x.confidence === "certeza",
  ).length;

  return (
    <>
      <Card className="hero glow">
        <span className="pill">Adaptive Engine</span>
        <h1 style={{ fontSize: "clamp(34px,4vw,52px)" }}>
          Treino montado pelo seu padrão de erros.
        </h1>
        <p>
          O motor pontua conteúdos fracos, erros com certeza, questões lentas, revisões
          vencidas e tópicos pouco testados — uma fila personalizada, não aleatória.
        </p>
        <div className="row">
          <button className="btn" onClick={() => generate(15)} disabled={busy}>
            Gerar Adaptive 15
          </button>
          <button className="btn secondary" onClick={() => generate(30)} disabled={busy}>
            Adaptive 30
          </button>
        </div>
        {(busy || err) && (
          <div className="notice" style={{ marginTop: 12 }}>
            {busy && (
              <span className="loader" style={{ display: "inline-block", marginRight: 8 }} />
            )}
            {busy ? "Montando fila adaptativa…" : err}
          </div>
        )}
      </Card>

      <div className="grid grid4" style={{ marginTop: 14 }}>
        <Metric label="Revisões vencidas" value={due.length} />
        <Metric label="Erros com certeza" value={certezaWrong} />
        <Metric label="Conteúdos fracos" value={weak.length} />
        <Metric label="Fila priorizada" value={cand.length} />
      </div>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <Card>
          <h2>Fila adaptativa</h2>
          <div className="queue">
            {cand.length === 0 && <Empty>Sem erros para priorizar.</Empty>}
            {cand.slice(0, 10).map((x) => (
              <div className="queueItem" key={`${x.attemptId}-${x.key}`}>
                <div className="qnum">{x.index}</div>
                <div>
                  <b>{x.content}</b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {examLabel(providerId)} {x.year} • {x.confidence || "sem confiança"} • {shortSec(x.timeSec)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h2>Por que isso está sendo recomendado?</h2>
          <div className="studyBlock">
            <div className="prio">ordem sugerida</div>
            <h3>1. Retenção</h3>
            <div className="muted">
              {due.length ? `${due.length} revisão(ões) vencida(s).` : "Nenhuma revisão vencida."}
            </div>
          </div>
          <div className="studyBlock" style={{ marginTop: 8 }}>
            <div className="prio">2. conteúdos</div>
            <h3>{weak[0]?.name || "Gerar amostra"}</h3>
            <div className="muted">
              {weak.length
                ? weak.map((x) => `${x.name} (${x.p}%)`).join(" • ")
                : "Ainda faltam dados para medir domínio."}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
