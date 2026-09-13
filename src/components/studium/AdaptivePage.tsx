"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { shortSec } from "@/lib/format";
import { officialRowsOf, weakestContents } from "@/lib/domain/stats";
import { adaptiveCandidates } from "@/lib/domain/adaptive";
import { dueSRS } from "@/lib/domain/srs";
import { buildProviderAdaptiveAttempt } from "@/lib/services/provider-study";
import { useActiveProvider } from "@/components/ExamSwitch";
import { examLabel } from "@/lib/providers/label";
import { Metric, Empty, Card } from "@/components/ui";

export default function AdaptivePage() {
  const db = useStore((state) => state.db);
  const addAttempt = useStore((state) => state.addAttempt);
  const router = useRouter();
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate(size: number) {
    setBusy(true);
    setError("");
    try {
      const attempt = await buildProviderAdaptiveAttempt(db, providerId, size);
      addAttempt(attempt);
      router.push(`/exam/${attempt.id}`);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }

  if (!hydrated) {
    return (
      <Card>
        <span className="muted">Carregando…</span>
      </Card>
    );
  }

  const candidates = adaptiveCandidates(db, providerId);
  const weak = weakestContents(db, 4, providerId);
  const due = dueSRS(db, providerId);
  const highConfidenceErrors = officialRowsOf(db, providerId).filter(
    (row) => row.isCorrect === false && row.confidence === "certeza",
  ).length;

  return (
    <>
      <Card className="hero glow">
        <span className="pill">Adaptive Engine</span>
        <h1 style={{ fontSize: "clamp(34px,4vw,52px)" }}>
          Treino montado pelo seu padrão de erros.
        </h1>
        <p>
          O motor prioriza fraquezas, erros relevantes, questões lentas, revisões vencidas
          e tópicos pouco testados sempre dentro da prova ativa.
        </p>
        <div className="row">
          <button className="btn" onClick={() => generate(15)} disabled={busy}>
            Gerar Adaptive 15
          </button>
          <button className="btn secondary" onClick={() => generate(30)} disabled={busy}>
            Adaptive 30
          </button>
        </div>
        {(busy || error) && (
          <div className="notice" style={{ marginTop: 12 }}>
            {busy && <span className="loader" style={{ display: "inline-block", marginRight: 8 }} />}
            {busy ? "Montando fila adaptativa…" : error}
          </div>
        )}
      </Card>

      <div className="grid grid4" style={{ marginTop: 14 }}>
        <Metric label="Revisões vencidas" value={due.length} />
        <Metric label="Erros com certeza" value={highConfidenceErrors} />
        <Metric label="Conteúdos fracos" value={weak.length} />
        <Metric label="Fila priorizada" value={candidates.length} />
      </div>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <Card>
          <h2>Fila adaptativa</h2>
          <div className="queue">
            {candidates.length === 0 && <Empty>Sem erros para priorizar.</Empty>}
            {candidates.slice(0, 10).map((item) => (
              <div className="queueItem" key={`${item.attemptId}-${item.key}`}>
                <div className="qnum">{item.index}</div>
                <div>
                  <b>{item.content}</b>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {examLabel(providerId)} {item.year} • {item.confidence || "sem confiança"} • {shortSec(item.timeSec)}
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
                ? weak.map((item) => `${item.name} (${item.p}%)`).join(" • ")
                : "Ainda faltam dados para medir domínio."}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
