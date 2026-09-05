"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Target,
  CheckCircle2,
  RotateCcw,
  Flame,
  Zap,
  AlertTriangle,
  TrendingDown,
  ShieldCheck,
  ArrowRight,
  Play,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { pct } from "@/lib/format";
import { AREA_LABELS, AREA_ORDER } from "@/lib/domain/constants";
import {
  officialRows,
  areaStats,
  rollingRows,
  streakDays,
  weakestContents,
  evolutionSeries,
} from "@/lib/domain/stats";
import { dueSRS } from "@/lib/domain/srs";
import { AreaBar, Card } from "@/components/ui";
import { AnimatedNumber, Ring } from "@/components/dash";
import { DashboardSkeleton, Sk } from "@/components/Skeleton";

// Recharts é pesado: carrega sob demanda, fora do bundle inicial.
const EvolutionArea = dynamic(() => import("@/components/charts").then((m) => m.EvolutionArea), {
  ssr: false,
  loading: () => <Sk h={230} r={14} />,
});
const AreaRadar = dynamic(() => import("@/components/charts").then((m) => m.AreaRadar), {
  ssr: false,
  loading: () => <Sk h={260} r={14} />,
});

function saudacao(hora: number) {
  if (hora < 5) return "Boa madrugada";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export default function HomePage() {
  const db = useStore((s) => s.db);
  const goals = db.goals;
  const setGoals = useStore((s) => s.setGoals);
  const hydrated = useHydrated();
  // Relógio lido uma vez, fora da renderização pura.
  const [hora] = useState(() => new Date().getHours());

  if (!hydrated) return <DashboardSkeleton />;

  const rows = officialRows(db).filter((x) => x.correct);
  const roll = rollingRows(db, 100);
  const rollPct = roll.length ? pct(roll.filter((x) => x.isCorrect).length, roll.length) : null;
  const due = dueSRS(db).length;
  const streak = streakDays(db);
  const inProg = db.attempts.find((a) => !a.finishedAt);
  const stats = areaStats(db);
  const weak = weakestContents(db, 3);
  const evo = evolutionSeries(db);

  const completed = db.attempts.filter((a) => a.result);
  const best = completed.length
    ? Math.max(...completed.map((a) => pct(a.result!.correct, a.result!.total)))
    : 0;
  const longest = rows.reduce((b, _x, i, arr) => {
    let n = 0;
    for (let j = i; j < arr.length && arr[j].isCorrect; j++) n++;
    return Math.max(b, n);
  }, 0);

  const totalQ = rows.length;
  const overall = totalQ ? pct(rows.filter((x) => x.isCorrect).length, totalQ) : null;
  const PER_LEVEL = 50;
  const level = Math.floor(totalQ / PER_LEVEL) + 1;
  const xpInLevel = totalQ % PER_LEVEL;

  // Metas da semana
  const ws = new Date();
  ws.setHours(0, 0, 0, 0);
  ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const weekAttempts = db.attempts.filter((a) => a.result && new Date(a.finishedAt!) >= ws);
  const weekQ = weekAttempts.reduce((s, a) => s + (a.result!.total || 0), 0);
  const weekEss = weekAttempts.filter((a) => a.essay?.text?.trim()).length;
  const weekRev = weekAttempts
    .filter((a) => a.mode === "srs" || a.mode === "retry")
    .reduce((s, a) => s + (a.result!.total || 0), 0);

  // Atividade 90 dias
  const counts: Record<string, number> = {};
  db.attempts
    .filter((a) => a.result)
    .forEach((a) => {
      const d = new Date(a.finishedAt!).toISOString().slice(0, 10);
      counts[d] = (counts[d] || 0) + (a.result!.total || 0);
    });
  const days: { key: string; n: number; lv: string; title: string }[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const n = counts[key] || 0;
    const lv = n === 0 ? "" : n < 15 ? "l1" : n < 40 ? "l2" : n < 90 ? "l3" : "l4";
    days.push({ key, n, lv, title: `${d.toLocaleDateString("pt-BR")}: ${n} questões` });
  }

  const radar = AREA_ORDER.map((k) => {
    const v = stats[k] || { c: 0, t: 0 };
    return { area: AREA_LABELS[k], pct: v.t ? pct(v.c, v.t) : 0, n: v.t };
  });

  // Painel de alertas — só o que é verdade nos dados.
  const alerts: { cls: string; icon: React.ReactNode; title: string; desc: string; href: string; cta: string }[] =
    [];
  if (due > 0)
    alerts.push({
      cls: "crit",
      icon: <RotateCcw size={16} />,
      title: `${due} revisão(ões) vencida(s)`,
      desc: "Retenção rende mais que volume novo.",
      href: "/srs",
      cta: "Revisar",
    });
  if (weak.length)
    alerts.push({
      cls: "warn",
      icon: <AlertTriangle size={16} />,
      title: `Conteúdo frágil: ${weak[0].name}`,
      desc: `${weak[0].p}% de acerto em ${weak[0].t} questão(ões).`,
      href: "/plano",
      cta: "Plano",
    });
  if (streak === 0 && completed.length > 0)
    alerts.push({
      cls: "warn",
      icon: <TrendingDown size={16} />,
      title: "Ritmo interrompido",
      desc: "Você não registrou estudo hoje.",
      href: "/practice",
      cta: "Treinar",
    });
  if (!alerts.length)
    alerts.push({
      cls: "ok",
      icon: <ShieldCheck size={16} />,
      title: "Nenhum alerta ativo",
      desc: "Revisões em dia e sem quedas de ritmo.",
      href: "/practice",
      cta: "Treinar",
    });

  // A missão do dia.
  const missao = inProg
    ? { titulo: "Retomar a sessão em andamento", detalhe: `ENEM ${inProg.year} • ${inProg.mode}`, href: `/exam/${inProg.id}`, cta: "Continuar" }
    : due > 0
      ? { titulo: `Consolidar ${due} revisão(ões)`, detalhe: "Fila de repetição espaçada vencida", href: "/srs", cta: "Iniciar revisão" }
      : weak.length
        ? { titulo: `Atacar ${weak[0].name}`, detalhe: `Conteúdo mais frágil — ${weak[0].p}% de acerto`, href: "/plano", cta: "Ver plano" }
        : { titulo: "Calibrar seu perfil", detalhe: "Um sprint de 15 alimenta o motor adaptativo", href: "/practice", cta: "Montar treino" };

  return (
    <>
      {/* ---------- HERO DE MISSÃO ---------- */}
      <section className="dash-hero">
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 340px", minWidth: 0 }}>
            <span className="pill">{saudacao(hora)} · painel de missão</span>
            <h1 style={{ marginTop: 16 }}>
              {streak > 0 ? (
                <>
                  {streak} dia{streak > 1 ? "s" : ""} <br />
                  em órbita.
                </>
              ) : (
                <>
                  Pronto para <br />
                  decolar.
                </>
              )}
            </h1>
            <p style={{ color: "var(--text-dim)", maxWidth: 460, fontSize: 15.5 }}>
              {due > 0
                ? `${due} revisão(ões) aguardam. A retenção vem antes do volume.`
                : "O motor adaptativo recomenda; você mantém o controle da rota."}
            </p>

            <div className="row" style={{ marginTop: 24, gap: 12 }}>
              <Link className="btn bigAction link-btn" href={missao.href}>
                <Play size={16} /> {missao.cta}
              </Link>
              <Link className="btn secondary link-btn" href="/plano">
                Ver plano completo
              </Link>
              {streak > 0 && (
                <span className="streak-flame">
                  <Flame size={15} /> {streak}
                </span>
              )}
            </div>

            <div style={{ marginTop: 28, maxWidth: 420 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <span className="tele">Nível {level}</span>
                <span className="tele">
                  {xpInLevel}/{PER_LEVEL} para o próximo
                </span>
              </div>
              <div className="level-bar">
                <span style={{ width: `${(xpInLevel / PER_LEVEL) * 100}%` }} />
              </div>
            </div>
          </div>

          <Ring value={overall} size={168} stroke={10}>
            <b>
              {overall === null ? (
                "—"
              ) : (
                <AnimatedNumber value={overall} format={(n) => `${Math.round(n)}%`} />
              )}
            </b>
            <small>domínio geral</small>
          </Ring>
        </div>
      </section>

      {/* ---------- PRÓXIMA MISSÃO ---------- */}
      <Card className="glow" style={{ marginTop: 14 }}>
        <div className="row between" style={{ gap: 18 }}>
          <div style={{ minWidth: 0 }}>
            <span className="tele" style={{ color: "var(--brand)" }}>
              Próxima missão
            </span>
            <h2 style={{ fontSize: 25, letterSpacing: "-0.03em", margin: "10px 0 6px" }}>
              {missao.titulo}
            </h2>
            <div className="muted" style={{ fontSize: 13.5 }}>
              {missao.detalhe}
            </div>
          </div>
          <Link className="btn link-btn" href={missao.href}>
            {missao.cta} <ArrowRight size={15} />
          </Link>
        </div>
      </Card>

      {/* ---------- TELEMETRIA ---------- */}
      <div className="grid grid4" style={{ marginTop: 14 }}>
        {[
          {
            ico: <Target size={16} />,
            val: rollPct === null ? "—" : <AnimatedNumber value={rollPct} format={(n) => `${Math.round(n)}%`} />,
            lbl: "Últimas 100",
          },
          { ico: <CheckCircle2 size={16} />, val: <AnimatedNumber value={totalQ} />, lbl: "Questões reais" },
          { ico: <RotateCcw size={16} />, val: <AnimatedNumber value={due} />, lbl: "Revisões vencidas" },
          {
            ico: <Zap size={16} />,
            val: <AnimatedNumber value={streak} format={(n) => `${Math.round(n)}d`} />,
            lbl: "Sequência",
          },
        ].map((s, i) => (
          <div className="stat" key={i}>
            <div className="ico">{s.ico}</div>
            <div className="val">{s.val}</div>
            <div className="lbl">{s.lbl}</div>
          </div>
        ))}
      </div>

      {/* ---------- COMPOSIÇÃO ASSIMÉTRICA ---------- */}
      <div className="mission-grid">
        <div className="stack">
          <Card>
            <div className="row between">
              <div>
                <h2>Evolução do aproveitamento</h2>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  média móvel das questões corrigidas
                </div>
              </div>
              <span className="badge2">{rollPct === null ? "sem dados" : `${rollPct}%`}</span>
            </div>
            <div style={{ marginTop: 14 }}>
              <EvolutionArea values={evo} />
            </div>
          </Card>

          <Card>
            <div className="row between">
              <div>
                <h2>Atividade</h2>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  últimos 90 dias
                </div>
              </div>
              <span className="badge2">{streak} dia(s) seguidos</span>
            </div>
            <div className="weekGrid" style={{ marginTop: 16 }}>
              {days.map((d) => (
                <div key={d.key} className={`dayCell ${d.lv}`} title={d.title} />
              ))}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <h2>Alertas</h2>
            <div style={{ display: "grid", gap: 9, marginTop: 12 }}>
              {alerts.map((a, i) => (
                <div className="alertitem" key={i}>
                  <span className={`ai ${a.cls}`}>{a.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 650 }}>{a.title}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {a.desc}
                    </div>
                  </div>
                  <Link className="btn secondary link-btn" style={{ padding: "7px 12px", fontSize: 11.5 }} href={a.href}>
                    {a.cta}
                  </Link>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2>Radar por área</h2>
            <div className="muted" style={{ fontSize: 12.5 }}>
              acerto relativo entre as quatro áreas
            </div>
            <AreaRadar data={radar} />
          </Card>
        </div>
      </div>

      {/* ---------- ÁREAS + RECORDES ---------- */}
      <div className="grid grid2" style={{ marginTop: 14 }}>
        <Card>
          <h2>Áreas</h2>
          <div style={{ marginTop: 8 }}>
            {AREA_ORDER.map((k) => {
              const v = stats[k] || { c: 0, t: 0 };
              return <AreaBar key={k} name={AREA_LABELS[k]} c={v.c} t={v.t} />;
            })}
          </div>
        </Card>
        <Card>
          <h2>Recordes pessoais</h2>
          <div className="recordGrid" style={{ marginTop: 12 }}>
            <div className="record">
              <small>Melhor tentativa</small>
              <b>
                {best || "—"}
                {best ? "%" : ""}
              </b>
            </div>
            <div className="record">
              <small>Sequência de acertos</small>
              <b>{longest}</b>
            </div>
            <div className="record">
              <small>Questões na semana</small>
              <b>{weekQ}</b>
            </div>
          </div>
        </Card>
      </div>

      {/* ---------- METAS ---------- */}
      <Card style={{ marginTop: 14 }}>
        <h2>Metas da semana</h2>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Configuráveis; sem punição se você não bater.
        </div>
        {(
          [
            ["Questões", weekQ, "questions"],
            ["Redações", weekEss, "essays"],
            ["Revisões", weekRev, "reviews"],
          ] as const
        ).map(([name, val, key]) => (
          <div className="goalRow" key={key}>
            <b style={{ fontSize: 13 }}>{name}</b>
            <input
              type="number"
              min={0}
              value={goals[key]}
              aria-label={`Meta semanal de ${name.toLowerCase()}`}
              onChange={(e) => setGoals({ ...goals, [key]: Math.max(0, Number(e.target.value || 0)) })}
            />
            <div>
              <div className="goalProgress">
                <span style={{ width: `${Math.min(100, pct(val, goals[key] || 1))}%` }} />
              </div>
              <div className="tele" style={{ marginTop: 6 }}>
                {val} de {goals[key]}
              </div>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
