"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { pct, shortSec } from "@/lib/format";
import { rebuildSessions } from "@/lib/domain/stats";
import { Empty, Card } from "@/components/ui";

export default function HistoryPage() {
  const db = useStore((s) => s.db);
  const hydrated = useHydrated();
  const sessions = useMemo(() => (hydrated ? rebuildSessions(db) : []), [db, hydrated]);
  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  const sessionOf = new Map<string, string>();
  sessions.forEach((s) => s.attemptIds.forEach((id) => sessionOf.set(id, s.id)));

  return (
    <>
      <Card>
        <div className="row between">
          <div>
            <h2>Histórico</h2>
            <div className="muted">Tentativas salvas neste navegador.</div>
          </div>
          <Link className="btn link-btn" href="/practice">
            Novo
          </Link>
        </div>
        <div className="tablewrap" style={{ marginTop: 12 }}>
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
                    <td>ENEM {a.year}</td>
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
    </>
  );
}
