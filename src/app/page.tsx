"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Target,
  BarChart3,
  Flame,
  Clock,
  TrendingUp,
  CheckCircle2,
  FileText,
  ArrowRight,
  Crosshair,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { pct, shortSec } from "@/lib/format";
import { AREA_LABELS, AREA_ORDER } from "@/lib/domain/constants";
import {

  areaStats,
  rollingRows,
  streakDays,
  weakestContents,
  evolutionSeries,
} from "@/lib/domain/stats";
import { dueSRS } from "@/lib/domain/srs";
import DomainMap from "@/components/DomainMap";
import { AnimatedNumber, Ring } from "@/components/dash";
import { DashboardSkeleton, Sk } from "@/components/Skeleton";

const EvolutionArea = dynamic(() => import("@/components/charts").then((m) => m.EvolutionArea), {
  ssr: false,
  loading: () => <Sk h={230} r={14} />,
});

function saudacao(h: number) {
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/** Sparkline mínima para os indicadores da coluna direita. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="spark" />;
  const max = Math.max(...values, 1);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 74},${24 - (v / max) * 20}`)
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 74 26" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--brand)" strokeWidth={1.5} />
    </svg>
  );
}

const WD = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

export default function HomePage() {
  const db = useStore((s) => s.db);
  const hydrated = useHydrated();
  const [hora] = useState(() => new Date().getHours());
  const [hoje] = useState(() => new Date());

  if (!hydrated) return <DashboardSkeleton />;

  const roll = rollingRows(db, 100);
  const rollPct = roll.length ? pct(roll.filter((x) => x.isCorrect).length, roll.length) : null;
  const due = dueSRS(db).length;
  const streak = streakDays(db);
  const inProg = db.attempts.find((a) => !a.finishedAt);
  const stats = areaStats(db);
  const weak = weakestContents(db, 4);
  const evo = evolutionSeries(db);
  const completed = db.attempts.filter((a) => a.result);

  // ---- Meta diária: fatia da meta semanal ----
  const alvoDia = Math.max(1, Math.round((db.goals.questions || 0) / 7));
  const hojeKey = hoje.toISOString().slice(0, 10);
  const feitasHoje = completed
    .filter((a) => new Date(a.finishedAt!).toISOString().slice(0, 10) === hojeKey)
    .reduce((s, a) => s + (a.result!.total || 0), 0);
  const metaPct = Math.min(100, Math.round((feitasHoje / alvoDia) * 100));

  // ---- Semana corrente: dias com atividade ----
  const ws = new Date(hoje);
  ws.setHours(0, 0, 0, 0);
  ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const diasAtivos = WD.map((_, i) => {
    const d = new Date(ws);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    return completed.some((a) => new Date(a.finishedAt!).toISOString().slice(0, 10) === key);
  });

  // ---- Séries auxiliares (dados reais, sem inventar) ----
  const sessoesPorSemana: number[] = [];
  for (let w = 7; w >= 0; w--) {
    const ini = new Date(ws);
    ini.setDate(ini.getDate() - w * 7);
    const fim = new Date(ini);
    fim.setDate(fim.getDate() + 7);
    sessoesPorSemana.push(
      completed.filter((a) => {
        const t = new Date(a.finishedAt!);
        return t >= ini && t < fim;
      }).length,
    );
  }
  const deltaPP = evo.length >= 2 ? Math.round(evo[evo.length - 1] - evo[0]) : null;
  const tempoTotal = completed.reduce((s, a) => s + (a.elapsed || 0), 0);

  const areasMap = AREA_ORDER.map((k) => {
    const v = stats[k] || { c: 0, t: 0 };
    return { id: k, label: AREA_LABELS[k], pct: v.t ? pct(v.c, v.t) : null, n: v.t };
  });

  // ---- Próxima missão, derivada do estado real ----
  const missao = inProg
    ? {
        k: "sessão em andamento",
        t: `Retomar ENEM ${inProg.year}`,
        meta: [
          `${Object.keys(inProg.answers || {}).length}/${inProg.questionRefs.length} respondidas`,
          inProg.mode,
        ],
        href: `/exam/${inProg.id}`,
        cta: "Continuar sessão",
      }
    : due > 0
      ? {
          k: "prioridade: retenção",
          t: `Revisar ${due} ${due > 1 ? "itens" : "item"}`,
          meta: [`${due} vencidas`, "repetição espaçada"],
          href: "/srs",
          cta: "Iniciar revisão",
        }
      : weak.length
        ? {
            k: "prioridade: conteúdo frágil",
            t: `Revisar ${weak[0].name}`,
            meta: [
              `${weak[0].t} questões medidas`,
              `${weak.length} conteúdos frágeis`,
              `${weak[0].p}% de acerto`,
            ],
            href: "/plano",
            cta: "Iniciar sessão",
          }
        : {
            k: "calibração",
            t: "Montar seu primeiro treino",
            meta: ["15 questões", "~24 min"],
            href: "/practice",
            cta: "Iniciar sessão",
          };

  const recentes = [...completed]
    .sort((a, b) => +new Date(b.finishedAt!) - +new Date(a.finishedAt!))
    .slice(0, 5);

  // Usa o relógio capturado uma vez no estado: ler Date.now() aqui tornaria
  // a renderização impura.
  function haQuanto(iso: string) {
    const ms = hoje.getTime() - new Date(iso).getTime();
    const h = Math.floor(ms / 3600000);
    if (h < 1) return "agora há pouco";
    if (h < 24) return `há ${h}h`;
    const d = Math.floor(h / 24);
    return `há ${d} dia${d > 1 ? "s" : ""}`;
  }

  return (
    <>
      <header className="pagehead">
        <div className="eyebrow">
          Centro de controle ·{" "}
          {hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
        </div>
        <h1>{saudacao(hora)}.</h1>
        <div className="sub">
          {inProg
            ? "Você tem uma sessão em aberto."
            : due > 0
              ? "Sua fila de revisão está pronta."
              : "Sua próxima sessão já está pronta."}
        </div>
        <div className="aside">
          <div>
            Estudo transforma
            <br />
            possibilidades
            <br />
            em realidade.
            <i />
          </div>
          <div>
            Mais
            <br />
            conhecimento
            <br />
            mais futuro
            <i />
          </div>
        </div>
      </header>

      {/* ---------- FILEIRA 1 ---------- */}
      <div className="hrow hrow-1">
        <section className="hcard mission">
          <div className="brandtag">ENEM Lab</div>
          <div className="k">Próxima missão</div>
          <div className="head">
            <span className="badge">
              <Crosshair size={22} />
            </span>
            <h3>{missao.t}</h3>
          </div>
          <div className="meta">
            {missao.meta.map((m, i) => (
              <span key={i}>
                {i > 0 && " • "}
                <b>{m}</b>
              </span>
            ))}
          </div>
          <Link className="cta" href={missao.href}>
            {missao.cta} <ArrowRight size={17} />
          </Link>

          <svg className="art" viewBox="0 0 340 150" aria-hidden="true">
            <polyline
              points="0,140 46,112 78,124 118,70 152,96 196,44 238,86 276,58 340,104"
              fill="none"
              stroke="var(--brand)"
              strokeOpacity="0.5"
              strokeWidth="1.2"
            />
            <polyline
              points="0,150 46,126 78,136 118,90 152,112 196,66 238,102 276,78 340,118"
              fill="none"
              stroke="var(--brand)"
              strokeOpacity="0.22"
              strokeWidth="1"
            />
          </svg>
          <div className="sig">
            Pequenas sessões
            <br />
            grandes resultados
          </div>
        </section>

        <section className="hcard goal">
          <div className="ringbox">
            <Ring value={metaPct} size={186} stroke={13} />
            <div className="val">
              <b>
                <AnimatedNumber value={metaPct} format={(n) => `${Math.round(n)}`} />
                <i>%</i>
              </b>
              <small>Meta diária</small>
            </div>
          </div>
          <div className="weekdots">
            {WD.map((d, i) => (
              <div key={d} className={diasAtivos[i] ? "on" : ""}>
                <i />
                <span>{d}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="hcard statcol">
          <div className="statrow">
            <span className="chip">
              <BarChart3 size={18} />
            </span>
            <div>
              <div className="n">
                <AnimatedNumber value={completed.length} />
              </div>
              <div className="l">
                Sessões
                <br />
                realizadas
              </div>
            </div>
            <Spark values={sessoesPorSemana} />
          </div>

          <div className="statrow">
            <span className="chip">
              <Target size={18} />
            </span>
            <div>
              <div className="n">
                {rollPct === null ? (
                  "—"
                ) : (
                  <AnimatedNumber value={rollPct} format={(n) => `${Math.round(n)}%`} />
                )}
              </div>
              <div className="l">Taxa de acerto</div>
            </div>
            <Spark values={evo} />
          </div>

          <div className="statrow">
            <span className="chip" style={{ color: "#ff9d4d" }}>
              <Flame size={18} />
            </span>
            <div>
              <div className="n">{String(streak).padStart(2, "0")}</div>
              <div className="l">Dias em sequência</div>
            </div>
            <div className="dots5">
              {[0, 1, 2, 3, 4].map((i) => (
                <i key={i} className={i < Math.min(5, streak) ? "on" : ""} />
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ---------- FILEIRA 2 ---------- */}
      <div className="hrow hrow-2">
        <section className="hcard">
          <div className="htitle">
            <h2>Evolução de desempenho</h2>
            <span className="badge2">média móvel</span>
          </div>
          <EvolutionArea values={evo} />
          <div className="minigrid">
            <div className="mini">
              <span className="mi">
                <TrendingUp size={16} />
              </span>
              <div>
                <b>{deltaPP === null ? "—" : `${deltaPP > 0 ? "+" : ""}${deltaPP} p.p.`}</b>
                <span>vs. início da série</span>
              </div>
            </div>
            <div className="mini">
              <span className="mi">
                <BarChart3 size={16} />
              </span>
              <div>
                <b>{completed.length}</b>
                <span>sessões corrigidas</span>
              </div>
            </div>
            <div className="mini">
              <span className="mi">
                <Clock size={16} />
              </span>
              <div>
                <b>{tempoTotal ? shortSec(tempoTotal) : "—"}</b>
                <span>tempo total de estudo</span>
              </div>
            </div>
          </div>
        </section>

        <section className="hcard">
          <div className="htitle">
            <h2>Mapa de domínio</h2>
            <Link className="seeall" href="/mastery">
              Ver detalhes <ArrowRight size={13} />
            </Link>
          </div>
          <DomainMap areas={areasMap} />
        </section>

        <section className="hcard">
          <div className="htitle">
            <h2>Atividade recente</h2>
            <Link className="seeall" href="/history">
              Ver todas <ArrowRight size={13} />
            </Link>
          </div>
          <div className="actlist">
            {recentes.length ? (
              recentes.map((a) => (
                <Link className="actrow" href={`/result/${a.id}`} key={a.id}>
                  <span className="mark2">
                    <CheckCircle2 size={16} />
                  </span>
                  <div>
                    <div className="t">
                      {a.mode === "srs"
                        ? "Revisão espaçada"
                        : a.mode === "retry"
                          ? "Revisão de erros"
                          : a.realDay
                            ? `ENEM Real • Dia ${a.realDay}`
                            : `Sessão ENEM ${a.year}`}
                    </div>
                    <div className="s">
                      {pct(a.result!.correct, a.result!.total)}% • {a.result!.total} questões
                    </div>
                  </div>
                  <span className="w">{haQuanto(a.finishedAt!)}</span>
                </Link>
              ))
            ) : (
              <div className="actrow" style={{ borderTop: "none" }}>
                <span className="mark2 pend">
                  <FileText size={15} />
                </span>
                <div>
                  <div className="t">Nenhuma sessão ainda</div>
                  <div className="s">Corrija um treino para preencher o histórico</div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="pagefoot">
        <span>{"/// Foco hoje. Conquista sempre."}</span>
        <span className="end">
          ENEM Lab <i />
        </span>
      </footer>
    </>
  );
}
