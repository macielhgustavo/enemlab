"use client";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { contentPath } from "@/lib/domain/constants";
import {
  masteryStats,
  weakestContents,
  contentMasteryState,
  wilsonInterval,
} from "@/lib/domain/stats";
import { Empty, Card, PageHead } from "@/components/ui";
import { useActiveProvider } from "@/components/ExamSwitch";
import { getProvider, ENEM_PROVIDER_ID } from "@/lib/providers";

export default function MasteryPage() {
  const db = useStore((s) => s.db);
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  const isEnem = providerId === ENEM_PROVIDER_ID;
  const label = getProvider(providerId).metadata.shortLabel;
  const st = masteryStats(db, providerId);
  // A taxonomia completa de conteúdos é do ENEM. Em outra prova, mostrar a
  // lista inteira zerada seria ruído: só aparece o que foi medido.
  const entries = Object.entries(st).filter(([, v]) => (isEnem ? true : v.t > 0));
  const tested = entries.filter(([, v]) => v.t > 0).length;
  const weak = weakestContents(db, 8, providerId);

  // Tipos de erro classificados
  const reasonCounts: Record<string, number> = {};
  Object.values(db.notes).forEach((n) => {
    if (n.reason) reasonCounts[n.reason] = (reasonCounts[n.reason] || 0) + 1;
  });
  const reasonMax = Math.max(1, ...Object.values(reasonCounts));

  return (
    <>
      <PageHead
        eyebrow="Módulo · domínio"
        title={`Mapa de domínio · ${label}`}
        sub={`Desempenho medido apenas em ${label}: provas diferentes nunca se somam.`}
        right={<span className="badge2">{tested} conteúdos testados</span>}
      />

      <Card>
        <div className="htitle">
          <h2>Conteúdos</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            IC de Wilson 95% · uma questão pode contar em mais de um conteúdo
          </span>
        </div>
        <div className="masteryLegend" style={{ margin: "12px 0" }}>
          <span className="m">dominado</span>
          <span className="s">estável</span>
          <span className="w">fraco</span>
          <span className="u">não testado</span>
        </div>
        <div className="domainGrid">
          {entries.map(([name, v]) => {
            const state = contentMasteryState(db, name, v);
            return (
              <div className={`domain ${state.cls}`} key={name} style={{ textAlign: "left" }}>
                <div className="name">{name}</div>
                <div className="score">{state.p === null ? "—" : state.p + "%"}</div>
                <div className="path">
                  {state.label} • <span className={state.conf.cls}>conf. {state.conf.label}</span>{" "}
                  • n={v.t}
                </div>
                {v.t > 0 && (
                  <>
                    <div className="path">
                      IC95% {state.ci.low}–{state.ci.high}%
                    </div>
                    <div className="ciBar">
                      <span
                        className="range"
                        style={{
                          left: `${state.ci.low}%`,
                          width: `${Math.max(2, state.ci.high - state.ci.low)}%`,
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <Card>
          <h2>Pontos fracos</h2>
          <div className="queue">
            {weak.length === 0 && <Empty>Sem dados suficientes.</Empty>}
            {weak.map((x) => {
              const ci = wilsonInterval(x.c, x.t);
              return (
                <div className="queueItem" key={x.name}>
                  <div className="qnum">{x.p}%</div>
                  <div>
                    <b>{x.name}</b>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {x.c}/{x.t} • IC95% {ci.low}–{ci.high}%
                    </div>
                  </div>
                  <div className="hierarchy">
                    {contentPath(x.name).map((p) => (
                      <span key={p}>{p}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <h2>Tipos de erro</h2>
          <div className="reasonStats">
            {Object.keys(reasonCounts).length === 0 && (
              <Empty>Classifique erros para ver padrões.</Empty>
            )}
            {Object.entries(reasonCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div className="reasonRow" key={k}>
                  <b>{k}</b>
                  <div className="progress">
                    <span style={{ width: `${(v / reasonMax) * 100}%` }} />
                  </div>
                  <span>{v}</span>
                </div>
              ))}
          </div>
        </Card>
      </div>
    </>
  );
}
