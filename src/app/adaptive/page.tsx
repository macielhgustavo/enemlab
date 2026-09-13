"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { shortSec } from "@/lib/format";
import { officialRowsOf, weakestContents } from "@/lib/domain/stats";
import { adaptiveCandidates } from "@/lib/domain/adaptive";
import { dueSRS } from "@/lib/domain/srs";
import { buildAdaptiveAttempt } from "@/lib/services/attempts";
import { buildItaAdaptiveAttempt } from "@/lib/services/ita-attempts";
import {
  buildNextStudyAttempt,
  buildProviderAdaptiveAttempt,
  nextStudyAction,
} from "@/lib/services/provider-study";
import { useActiveProvider } from "@/components/ExamSwitch";
import { ENEM_PROVIDER_ID, ITA_PROVIDER_ID } from "@/lib/providers";
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

  async function openAttempt(factory: () => Promise<ReturnType<typeof buildItaAdaptiveAttempt>>) {
    setBusy(true);
    setErr("");
    try {
      const a = await factory();
      addAttempt(a);
      router.push(`/exam/${a.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  async function generate(n: number) {
    return openAttempt(async () => {
      if (isIta) return buildItaAdaptiveAttempt(db, n);
      if (providerId === ENEM_PROVIDER_ID) return buildAdaptiveAttempt(db, n);
      return buildProviderAdaptiveAttempt(db, providerId, n);
    });
  }

  async function continueCycle() {
    return openAttempt(() => buildNextStudyAttempt(db, providerId, 15));
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  const cand = adaptiveCandidates(db, providerId);
  const weak = weakestContents(db, 4, providerId);
  const due = dueSRS(db, providerId);
  const recommendation = nextStudyAction(db, providerId);
  const certezaWrong = officialRowsOf(db, providerId).filter(
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
          O motor combina retenção, domínio, erros, inéditas e diversidade por conteúdo.
          A mesma base produz a mesma fila: a prioridade agora é determinística e isolada por prova.
        </p>
        <div className="row">
          <button className="btn" onClick={continueCycle} disabled={busy}>
            Continuar ciclo
          </button>
          <button className="btn secondary" onClick={() => generate(15)} disabled={busy}>
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
            {busy ? "Montando a próxima etapa do ciclo…" : err}
          </div>
        )}
      </Card>

      <div className="grid grid4" style={{ marginTop: 14 }}>
        <Metric label="Revisões vencidas" value={due.length} />
        <Metric label="Erros com certeza" value={certezaWrong} />
        <Metric label="Conteúdos fracos" value={weak.filter((item) => item.p < 65).length} />
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
          <h2>Próxima ação</h2>
          <div className="studyBlock">
            <div className="prio">{recommendation.kind}</div>
            <h3>{recommendation.title}</h3>
            <div className="muted">{recommendation.reason}</div>
          </div>
          <div className="studyBlock" style={{ marginTop: 8 }}>
            <div className="prio">ordem do ciclo</div>
            <h3>Retenção → lacuna → erro → nova amostra</h3>
            <div className="muted">
              Revisões vencidas têm prioridade. Depois o motor repara conteúdos abaixo de 65%,
              refaz erros prioritários e só então avança para inéditas ou Adaptive.
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
