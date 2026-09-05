"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { pct, shortSec, richText } from "@/lib/format";
import { AREA_LABELS } from "@/lib/domain/constants";
import { discipline, questionKey } from "@/lib/domain/classify";
import { coherenceForAttempt, fatigueForAttempt } from "@/lib/domain/stats";
import { dueSRS } from "@/lib/domain/srs";
import {
  questionsForAttempt,
  buildRetryAttempt,
} from "@/lib/services/attempts";
import { AreaBar, Metric, Card } from "@/components/ui";
import MathContent from "@/components/MathContent";
import type { ResultRow } from "@/lib/domain/types";

export default function ResultPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const hydrated = useHydrated();
  const db = useStore((s) => s.db);
  const addAttempt = useStore((s) => s.addAttempt);
  const a = db.attempts.find((x) => x.id === id);
  const [showCorrection, setShowCorrection] = useState(false);

  const { data: questions } = useQuery({
    queryKey: ["attempt-questions", id],
    queryFn: () => questionsForAttempt(a!),
    enabled: hydrated && !!a && showCorrection,
    staleTime: Infinity,
  });

  const reports = useMemo(() => {
    if (!a?.result) return null;
    return { fat: fatigueForAttempt(a), co: coherenceForAttempt(db, a) };
  }, [a, db]);

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;
  if (!a?.result)
    return (
      <Card className="empty">
        Resultado não encontrado. <Link href="/history">Ver histórico</Link>
      </Card>
    );

  const r = a.result;
  const p = pct(r.correct, r.total);
  const valid = r.rows.filter((x) => x.correct);
  const avg = valid.length
    ? Math.round(valid.reduce((s, x) => s + x.timeSec, 0) / valid.length)
    : 0;
  const cw = valid.filter((x) => x.isCorrect === false && x.confidence === "certeza").length;
  const lucky = valid.filter((x) => x.isCorrect && x.confidence === "chute").length;

  const areas: Record<string, { c: number; t: number }> = {};
  valid.forEach((x) => {
    (areas[x.area] ??= { c: 0, t: 0 }).t++;
    if (x.isCorrect) areas[x.area].c++;
  });
  const sortedAreas = Object.entries(areas).sort(
    (x, y) => pct(x[1].c, x[1].t) - pct(y[1].c, y[1].t),
  );

  function retryWrong() {
    const wrong = r.rows.filter((x) => x.isCorrect === false);
    if (!wrong.length) {
      alert("Sem erros para refazer.");
      return;
    }
    const retry = buildRetryAttempt(a!, wrong);
    addAttempt(retry);
    router.push(`/exam/${retry.id}`);
  }

  const usedQ = Math.round(a.questionSec || a.elapsed || 0);
  const usedE = Math.round(a.essaySec || 0);
  const remaining = Math.max(0, Math.round((a.minutes || 0) * 60 - (a.elapsed || 0)));

  // Relatório pós-prova
  const blocks: React.ReactNode[] = [];
  const weakest = Object.entries(
    valid.reduce<Record<string, { c: number; t: number }>>((o, x) => {
      (o[x.content] ??= { c: 0, t: 0 }).t++;
      if (x.isCorrect) o[x.content].c++;
      return o;
    }, {}),
  )
    .map(([kk, v]) => ({ k: kk, p: pct(v.c, v.t), ...v }))
    .sort((x, y) => x.p - y.p)[0];
  const fatDrop = reports ? reports.fat[0].p - reports.fat[2].p : 0;
  if (weakest)
    blocks.push(
      <div className="reportBlock" key="weak">
        <strong>Conteúdo mais fraco: {weakest.k}</strong>
        <span className="muted">
          {weakest.c}/{weakest.t} ({weakest.p}%).
        </span>
      </div>,
    );
  if (fatDrop >= 12)
    blocks.push(
      <div className="reportBlock" key="fat">
        <strong>Possível fadiga</strong>
        <span className="muted">
          Aproveitamento caiu {fatDrop} pontos do início para o final.
        </span>
      </div>,
    );
  const dueNow = dueSRS(db).length;
  blocks.push(
    <div className="reportBlock" key="next">
      <strong>Próxima ação</strong>
      <span className="muted">
        {dueNow
          ? `Faça as ${dueNow} revisões vencidas antes de buscar volume novo.`
          : weakest
            ? `Faça um bloco curto focado em ${weakest.k}.`
            : "Faça um Adaptive 15 para ampliar a amostra."}
      </span>
    </div>,
  );

  return (
    <>
      <Card className="hero">
        <span className="pill">Resultado instantâneo</span>
        <h1 style={{ fontSize: 50 }}>
          {r.correct}/{r.total} • {p}%
        </h1>
        <p>
          ENEM {a.year}. Acertos brutos; não é TRI.
          {a.essay ? " Redação salva separadamente." : ""}
        </p>
        <div className="row">
          <button className="btn" onClick={retryWrong}>
            Refazer erradas
          </button>
          <Link className="btn secondary link-btn" href="/adaptive">
            Adaptive
          </Link>
          <Link className="btn secondary link-btn" href="/srs">
            Revisões
          </Link>
          <Link className="btn secondary link-btn" href="/">
            Início
          </Link>
        </div>
      </Card>

      <div className="grid grid4" style={{ marginTop: 14 }}>
        <Metric label="Aproveitamento" value={`${p}%`} />
        <Metric label="Em branco" value={r.blank} />
        <Metric label="Tempo médio" value={shortSec(avg)} />
        <Metric label="Erros com certeza" value={cw} />
      </div>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <Card>
          <h2>Por área</h2>
          {Object.entries(areas).map(([kk, v]) => (
            <AreaBar key={kk} name={AREA_LABELS[kk] || kk} c={v.c} t={v.t} />
          ))}
        </Card>
        <Card>
          <h2>Diagnóstico</h2>
          <div style={{ lineHeight: 1.7 }}>
            {sortedAreas.length > 0 && (
              <>
                Prioridade:{" "}
                <b>{AREA_LABELS[sortedAreas[0][0]] || sortedAreas[0][0]}</b> (
                {pct(sortedAreas[0][1].c, sortedAreas[0][1].t)}%).{" "}
              </>
            )}
            Erros com certeza: <b>{cw}</b>. Acertos por chute: <b>{lucky}</b>.
            {a.essay?.text
              ? ` Redação registrada com ${
                  (a.essay.text.trim().match(/\S+/g) || []).length
                } palavras.`
              : ""}
          </div>
        </Card>
      </div>

      {reports && (
        <div className="grid grid2" style={{ marginTop: 14 }}>
          <Card>
            <h2>Ritmo e fadiga</h2>
            <div className="reportBlocks">
              {reports.fat.map((x) => (
                <div className="reportBlock" key={x.name}>
                  <strong>
                    {x.name}: {x.p}%
                  </strong>
                  <span className="muted">
                    {x.n} questões • {shortSec(x.avg)} por questão
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h2>Coerência do desempenho</h2>
            <div className="metric">
              <small>Coerência pessoal estimada</small>
              <b
                className={
                  reports.co.label === "alta"
                    ? "coherenceHigh"
                    : reports.co.label === "média"
                      ? "coherenceMed"
                      : "coherenceLow"
                }
              >
                {reports.co.label}
              </b>
              <div className="muted">
                Erros em itens fáceis: {reports.co.easyWrong}/{reports.co.easy}. Acertos em
                difíceis: {reports.co.hardCorrect}/{reports.co.hard}. Não é TRI.
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card style={{ marginTop: 14 }}>
        <h2>Relatório pós-prova</h2>
        <div className="reportBlock" style={{ marginBottom: 10 }}>
          <strong>Uso do tempo</strong>
          <div className="timeSplit" style={{ marginTop: 8 }}>
            <div>
              <small>Questões</small>
              <b>{shortSec(usedQ)}</b>
            </div>
            <div>
              <small>Redação</small>
              <b>{a.essay ? shortSec(usedE) : "—"}</b>
            </div>
            <div>
              <small>Restante</small>
              <b>{shortSec(remaining)}</b>
            </div>
          </div>
        </div>
        <div className="reportBlocks">{blocks}</div>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <div className="row between">
          <h2>Mapa da tentativa</h2>
          <button className="btn secondary" onClick={() => setShowCorrection((v) => !v)}>
            {showCorrection ? "Ocultar revisão" : "Revisar visualmente"}
          </button>
        </div>
        <div className="heatmap" style={{ marginTop: 12 }}>
          {r.rows.map((x) => (
            <div
              key={x.key}
              className={`heat ${!x.selected ? "blank" : x.isCorrect ? "ok" : "bad"}`}
              title={`Q${x.index}: ${x.content}`}
            >
              {x.index}
            </div>
          ))}
        </div>
      </Card>

      {showCorrection && (
        <Card style={{ marginTop: 14 }}>
          <h2>Revisão visual</h2>
          {!questions ? (
            <div className="row" style={{ gap: 10, marginTop: 10 }}>
              <span className="loader" />
              <span className="muted">Carregando questões…</span>
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              {r.rows.map((row) => (
                <CorrectionItem key={row.key} row={row} questions={questions} />
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function CorrectionItem({
  row,
  questions,
}: {
  row: ResultRow;
  questions: import("@/lib/domain/types").Question[];
}) {
  const q =
    questions.find((x) => x.index === row.index && discipline(x) === row.area) ||
    questions.find((x) => x.index === row.index);
  if (!q) return null;
  return (
    <div className="reviewQuestion" style={{ borderTop: "1px solid var(--line)", padding: "16px 0" }}>
      <div className="reviewMeta">
        <span className="badge2">Q{row.index}</span>
        <span className="badge2">{row.content}</span>
        <span className="badge2">{shortSec(row.timeSec)}</span>
        <span className={`badge2 ${row.isCorrect ? "diffEasy" : "diffHard"}`}>
          {row.isCorrect ? "acerto" : row.selected ? "erro" : "em branco"}
        </span>
      </div>
      {q.context && <MathContent className="context" html={richText(q.context)} />}
      {q.alternativesIntroduction && (
        <MathContent className="intro" html={richText(q.alternativesIntroduction)} />
      )}
      <div className="answers">
        {(q.alternatives || []).map((alt) => {
          const cls =
            alt.letter === row.correct
              ? "correctReview"
              : alt.letter === row.selected && !row.isCorrect
                ? "wrongReview"
                : "";
          return (
            <div className={`answer ${cls}`} key={alt.letter}>
              <span className="letter">{alt.letter}</span>
              <span className="altText">
                <MathContent html={richText(alt.text || "")} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
