"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { pct, shortSec } from "@/lib/format";
import { rebuildSessions, coherenceForAttempt } from "@/lib/domain/stats";
import { Empty, Card, PageHead } from "@/components/ui";
import { examLabel } from "@/lib/providers/label";

export default function HistoryPage() {
  const db = useStore((s) => s.db);
  const hydrated = useHydrated();
  const sessions = useMemo(() => (hydrated ? rebuildSessions(db) : []), [db, hydrated]);
  const completed = db.attempts.filter((a) => a.result);
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");
  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  const a1 = db.attempts.find((x) => x.id === (cmpA || completed[0]?.id));
  const a2 = db.attempts.find((x) => x.id === (cmpB || completed[1]?.id));
  const metrics = (a: typeof a1) =>
    a?.result
      ? {
          p: pct(a.result.correct, a.result.total),
          avg: Math.round(
            a.result.rows.reduce((s, r) => s + (r.timeSec || 0), 0) / Math.max(1, a.result.rows.length),
          ),
          co: coherenceForAttempt(db, a),
        }
      : null;
  const mA = metrics(a1);
  const mB = metrics(a2);

  const sessionOf = new Map<string, string>();
  sessions.forEach((s) => s.attemptIds.forEach((id) => sessionOf.set(id, s.id)));

  return (
    <>
      <PageHead
        eyebrow="Módulo · histórico"
        title="Histórico"
        sub="Tentativas salvas neste navegador, com sessão e resultado."
        right={
          <Link className="btn link-btn" href="/practice">
            Novo treino
          </Link>
        }
      />

      <Card>
        <div className="htitle">
          <h2>Tentativas</h2>
          <span className="badge2">{db.attempts.length} registradas</span>
        </div>
        <div className="tablewrap">
          {db.attempts.length === 0 ? (
            <Empty>Nenhuma tentativa.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Fonte</th>
                  <th>Modo</th>
                  <th>Resultado</th>
                  <th>Sessão</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {db.attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.startedAt).toLocaleString("pt-BR")}</td>
                    <td>{examLabel(a.providerId)} {a.year}</td>
                    <td>{a.realDay ? `real dia ${a.realDay}` : a.mode}</td>
                    <td>
                      <b>
                        {a.result
                          ? `${a.result.correct}/${a.result.total} (${pct(
                              a.result.correct,
                              a.result.total,
                            )}%)`
                          : "em andamento"}
                      </b>
                    </td>
                    <td>
                      <span className="sessionChip">{sessionOf.get(a.id) || "—"}</span>
                    </td>
                    <td>
                      <Link
                        className="btn secondary link-btn"
                        href={a.result ? `/result/${a.id}` : `/exam/${a.id}`}
                      >
                        {a.result ? "Ver" : "Continuar"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <div className="row between">
          <div>
            <h2>Sessões de estudo</h2>
            <div className="muted">
              Agrupamento por blocos de atividade; fecha após ~90 min sem nova atividade ou
              mudança de dia.
            </div>
          </div>
          <span className="badge2">{sessions.length} sessão(ões)</span>
        </div>
        <div className="sessionCards" style={{ marginTop: 12 }}>
          {sessions.length === 0 && <Empty>Nenhuma sessão ainda.</Empty>}
          {[...sessions]
            .reverse()
            .slice(0, 9)
            .map((x) => {
              const dur = Math.max(0, (+new Date(x.lastAt) - +new Date(x.startedAt)) / 1000);
              const top = Object.entries(x.contents || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map((e) => e[0])
                .join(" • ");
              return (
                <div className="sessionCard" key={x.id}>
                  <small>{new Date(x.startedAt).toLocaleDateString("pt-BR")}</small>
                  <b>{x.total ? pct(x.correct, x.total) + "%" : "sessão aberta"}</b>
                  <div className="sessionDetail">
                    <div className="sessionLine">
                      <span>Questões</span>
                      <span>{x.questions}</span>
                    </div>
                    <div className="sessionLine">
                      <span>Duração</span>
                      <span>{shortSec(dur)}</span>
                    </div>
                    <div className="sessionLine">
                      <span>Revisões</span>
                      <span>{x.reviews}</span>
                    </div>
                    <div className="sessionLine">
                      <span>Redações</span>
                      <span>{x.essays}</span>
                    </div>
                    {top && <div className="path">{top}</div>}
                  </div>
                </div>
              );
            })}
        </div>
      </Card>

      {completed.length >= 2 && (
        <Card style={{ marginTop: 14 }}>
          <h2>Comparar tentativas</h2>
          <div className="grid grid2" style={{ marginTop: 8 }}>
            <div>
              <label>Tentativa A</label>
              <select value={cmpA || completed[0]?.id} onChange={(e) => setCmpA(e.target.value)}>
                {completed.map((a) => (
                  <option key={a.id} value={a.id}>
                    {new Date(a.finishedAt!).toLocaleDateString("pt-BR")} • {examLabel(a.providerId)} {a.year} •{" "}
                    {pct(a.result!.correct, a.result!.total)}%
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Tentativa B</label>
              <select value={cmpB || completed[1]?.id} onChange={(e) => setCmpB(e.target.value)}>
                {completed.map((a) => (
                  <option key={a.id} value={a.id}>
                    {new Date(a.finishedAt!).toLocaleDateString("pt-BR")} • ENEM {a.year} •{" "}
                    {pct(a.result!.correct, a.result!.total)}%
                  </option>
                ))}
              </select>
            </div>
          </div>
          {mA && mB && a1 && a2 && (
            <div style={{ marginTop: 12 }}>
              <div className="compareGrid">
                <div className="compareSide">
                  <b>
                    {examLabel(a1.providerId)} {a1.year} • {mA.p}%
                  </b>
                  <div className="muted">
                    tempo médio {shortSec(mA.avg)} • coerência {mA.co.label}
                  </div>
                </div>
                <div className="vs">VS</div>
                <div className="compareSide">
                  <b>
                    {examLabel(a2.providerId)} {a2.year} • {mB.p}%
                  </b>
                  <div className="muted">
                    tempo médio {shortSec(mB.avg)} • coerência {mB.co.label}
                  </div>
                </div>
              </div>
              <div className="notice" style={{ marginTop: 10 }}>
                {mB.p - mA.p >= 3
                  ? "A segunda tentativa teve aproveitamento maior."
                  : mA.p - mB.p >= 3
                    ? "A primeira tentativa teve aproveitamento maior."
                    : "Os aproveitamentos ficaram próximos."}{" "}
                Compare também composição e dificuldade pessoal antes de concluir evolução.
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
