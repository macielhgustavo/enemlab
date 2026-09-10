"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { pct, shortSec } from "@/lib/format";
import { rebuildSessions, coherenceForAttempt } from "@/lib/domain/stats";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { HistoryItem } from "@/components/enem-lab/HistoryItem";
import { EmptyState } from "@/components/enem-lab/states";
import { FilterChip } from "@/components/enem-lab/FilterBar";
import { listProviders, resolveProviderId } from "@/lib/providers";
import { examLabel } from "@/lib/providers/label";

export default function HistoryPage() {
  const db = useStore((s) => s.db);
  const hydrated = useHydrated();
  const [filtro, setFiltro] = useState<string>("all");
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

  // Bancas que realmente aparecem no histórico — não a lista de providers.
  const provasNoHistorico = [
    ...new Set(db.attempts.map((a) => resolveProviderId(a.providerId))),
  ].filter((id) => listProviders().some((p) => p.id === id));

  const visiveis =
    filtro === "all"
      ? db.attempts
      : db.attempts.filter((a) => resolveProviderId(a.providerId) === filtro);

  return (
    <>
      <PageHeader
        eyebrow="Módulo · histórico"
        title="Histórico"
        description="Todas as provas, juntas de propósito: cada linha identifica a banca."
        meta={
          <>
            <span>{db.attempts.length} tentativas</span>
            {provasNoHistorico.length > 1 && <span>{provasNoHistorico.length} provas</span>}
          </>
        }
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/practice">Novo treino</Link>
          </Button>
        }
      />

      {/* O filtro só existe quando há mais de uma banca no histórico: com uma
          prova só, ele seria um controle que não faz nada. */}
      {provasNoHistorico.length > 1 && (
        <div className="el-histfilter" role="group" aria-label="Filtrar por prova">
          <FilterChip active={filtro === "all"} onClick={() => setFiltro("all")}>
            Todas
          </FilterChip>
          {provasNoHistorico.map((id) => (
            <FilterChip key={id} active={filtro === id} onClick={() => setFiltro(id)}>
              {examLabel(id)}
            </FilterChip>
          ))}
        </div>
      )}

      <div className="el-histlist">
        {visiveis.length === 0 ? (
          <EmptyState
            title={db.attempts.length === 0 ? "Nenhuma tentativa ainda" : "Nada nesta prova"}
            description={
              db.attempts.length === 0
                ? "Monte um treino: cada sessão corrigida entra aqui com data, desempenho e duração."
                : "Troque o filtro para ver as tentativas das outras provas."
            }
            action={
              db.attempts.length === 0 ? (
                <Button asChild variant="primary" size="sm">
                  <Link href="/practice">Montar treino</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          visiveis.map((a) => (
            <HistoryItem key={a.id} attempt={a} sessionId={sessionOf.get(a.id)} />
          ))
        )}
      </div>

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
          {sessions.length === 0 && (
            <EmptyState
              title="Nenhuma sessão ainda"
              description="Sessões agrupam blocos de estudo do mesmo dia."
            />
          )}
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
