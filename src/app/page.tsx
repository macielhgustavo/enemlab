"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import {
  Target,
  CheckCircle2,
  RotateCcw,
  Flame,
  Zap,
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
import { AnimatedNumber, Ring } from "@/components/dash";
import { DashboardSkeleton, Sk } from "@/components/Skeleton";

const EvolutionArea = dynamic(() => import("@/components/charts").then((m) => m.EvolutionArea), {
  ssr: false,
  loading: () => <Sk h={260} r={14} />,
});
const AreaRadar = dynamic(() => import("@/components/charts").then((m) => m.AreaRadar), {
  ssr: false,
  loading: () => <Sk h={260} r={14} />,
});

function saudacao(hora: number) {
  if (hora < 5) return "Madrugada";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

// Entrada escalonada das bandas: movimento que comunica ordem de leitura.
function Band({
  children,
  i = 0,
  className = "",
}: {
  children: React.ReactNode;
  i?: number;
  className?: string;
}) {
  return (
    <motion.section
      className={`band ${className}`}
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: i * 0.09, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.section>
  );
}

export default function HomePage() {
  const db = useStore((s) => s.db);
  const goals = db.goals;
  const setGoals = useStore((s) => s.setGoals);
  const hydrated = useHydrated();
  const [hora] = useState(() => new Date().getHours());

  if (!hydrated) return <DashboardSkeleton />;

  const rows = officialRows(db).filter((x) => x.correct);
  const roll = rollingRows(db, 100);
  const rollPct = roll.length ? pct(roll.filter((x) => x.isCorrect).length, roll.length) : null;
  const due = dueSRS(db).length;
  const streak = streakDays(db);
  const inProg = db.attempts.find((a) => !a.finishedAt);
  const stats = areaStats(db);
  const weak = weakestContents(db, 4);
  const evo = evolutionSeries(db);
  const completed = db.attempts.filter((a) => a.result);

  const totalQ = rows.length;
  const overall = totalQ ? pct(rows.filter((x) => x.isCorrect).length, totalQ) : null;
  const PER_LEVEL = 50;
  const level = Math.floor(totalQ / PER_LEVEL) + 1;
  const xpInLevel = totalQ % PER_LEVEL;

  const best = completed.length
    ? Math.max(...completed.map((a) => pct(a.result!.correct, a.result!.total)))
    : 0;

  const ws = new Date();
  ws.setHours(0, 0, 0, 0);
  ws.setDate(ws.getDate() - ((ws.getDay() + 6) % 7));
  const weekAttempts = db.attempts.filter((a) => a.result && new Date(a.finishedAt!) >= ws);
  const weekQ = weekAttempts.reduce((s, a) => s + (a.result!.total || 0), 0);
  const weekEss = weekAttempts.filter((a) => a.essay?.text?.trim()).length;
  const weekRev = weekAttempts
    .filter((a) => a.mode === "srs" || a.mode === "retry")
    .reduce((s, a) => s + (a.result!.total || 0), 0);

  const counts: Record<string, number> = {};
  completed.forEach((a) => {
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

  const missao = inProg
    ? {
        k: "sessão em andamento",
        t: `Retomar ENEM ${inProg.year}`,
        d: `${Object.keys(inProg.answers || {}).length}/${inProg.questionRefs.length} respondidas • ${inProg.mode}`,
        href: `/exam/${inProg.id}`,
      }
    : due > 0
      ? {
          k: "prioridade: retenção",
          t: `Consolidar ${due} revisão${due > 1 ? "ões" : ""}`,
          d: "A fila de repetição espaçada venceu. Rende mais que volume novo.",
          href: "/srs",
        }
      : weak.length
        ? {
            k: "prioridade: conteúdo frágil",
            t: `Atacar ${weak[0].name}`,
            d: `${weak[0].p}% de acerto em ${weak[0].t} questão(ões) medidas.`,
            href: "/plano",
          }
        : {
            k: "calibração",
            t: "Montar seu primeiro sprint",
            d: "15 questões bastam para o motor adaptativo aprender seu perfil.",
            href: "/practice",
          };

  const urgentes: { cls: string; n: string; t: string; d: string; href: string }[] = [];
  if (due > 0)
    urgentes.push({
      cls: "crit",
      n: String(due),
      t: "Revisões vencidas",
      d: "Fila de repetição espaçada",
      href: "/srs",
    });
  weak.slice(0, 2).forEach((w) =>
    urgentes.push({
      cls: "warn",
      n: `${w.p}%`,
      t: w.name,
      d: `${w.c}/${w.t} acertos medidos`,
      href: "/plano",
    }),
  );
  if (streak === 0 && completed.length > 0)
    urgentes.push({
      cls: "warn",
      n: "0d",
      t: "Ritmo interrompido",
      d: "Nenhum estudo registrado hoje",
      href: "/practice",
    });
  if (!urgentes.length)
    urgentes.push({
      cls: "ok",
      n: "OK",
      t: "Nenhuma pendência",
      d: "Revisões em dia e ritmo mantido",
      href: "/practice",
    });

  return (
    <>
      {/* ---------- BANDA 1 — BRIEF ---------- */}
      <Band i={0}>
        <div className="brief">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">
              <span className="sysdot" />
              {saudacao(hora)} · nível {level} · {totalQ} questões medidas
            </div>
            <h1>
              {streak > 0 ? (
                <>
                  {streak} dia{streak > 1 ? "s" : ""} <em>em órbita</em>
                </>
              ) : overall !== null ? (
                <>
                  Domínio <em>em construção</em>
                </>
              ) : (
                <>
                  Pronto para <em>decolar</em>
                </>
              )}
            </h1>
            <p className="lede">
              {due > 0
                ? `${due} revisão(ões) venceram. Retenção antes de volume — é assim que a curva sobe.`
                : weak.length
                  ? `Seu ponto mais frágil agora é ${weak[0].name}, com ${weak[0].p}% de acerto.`
                  : "O motor adaptativo recomenda a rota; você mantém o controle."}
            </p>

            <Link className="hugeaction" href={missao.href}>
              <span className="go">
                <Play size={24} fill="currentColor" />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="k">Próxima missão · {missao.k}</span>
                <div className="t">{missao.t}</div>
                <div className="d">{missao.d}</div>
              </span>
              <ArrowRight size={22} className="arrow" style={{ color: "var(--brand)" }} />
            </Link>

            <div style={{ marginTop: 26, maxWidth: 460 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <span className="tele">Progresso do nível {level}</span>
                <span className="tele">
                  {xpInLevel}/{PER_LEVEL}
                </span>
              </div>
              <div className="level-bar">
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: `${(xpInLevel / PER_LEVEL) * 100}%` }}
                  transition={{ duration: 1.1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", justifyItems: "center", gap: 18 }}>
            <Ring value={overall} size={196} stroke={9}>
              <b>
                {overall === null ? (
                  "—"
                ) : (
                  <AnimatedNumber value={overall} format={(n) => `${Math.round(n)}%`} />
                )}
              </b>
              <small>domínio geral</small>
            </Ring>
            {streak > 0 && (
              <span className="streak-flame">
                <Flame size={15} /> {streak} dia{streak > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </Band>

      {/* ---------- BANDA 2 — TELEMETRIA ---------- */}
      <Band i={1}>
        <div className="telestrip">
          <div className="cell">
            <div className="k">
              <Target size={12} /> Últimas 100
            </div>
            <div className="v accent">
              {rollPct === null ? "—" : <AnimatedNumber value={rollPct} format={(n) => `${Math.round(n)}%`} />}
            </div>
            <div className="s">{roll.length} questões na janela</div>
          </div>
          <div className="cell">
            <div className="k">
              <CheckCircle2 size={12} /> Questões reais
            </div>
            <div className="v">
              <AnimatedNumber value={totalQ} />
            </div>
            <div className="s">{completed.length} sessões corrigidas</div>
          </div>
          <div className="cell">
            <div className="k">
              <RotateCcw size={12} /> Fila de revisão
            </div>
            <div className="v" style={{ color: due > 0 ? "var(--bad)" : undefined }}>
              <AnimatedNumber value={due} />
            </div>
            <div className="s">{due > 0 ? "vencidas agora" : "nada vencido"}</div>
          </div>
          <div className="cell">
            <div className="k">
              <Zap size={12} /> Melhor tentativa
            </div>
            <div className="v">{best ? <AnimatedNumber value={best} format={(n) => `${Math.round(n)}%`} /> : "—"}</div>
            <div className="s">{weekQ} questões nesta semana</div>
          </div>
        </div>
      </Band>

      {/* ---------- BANDA 3 — EVOLUÇÃO ---------- */}
      <Band i={2}>
        <div className="band-title">
          <h2>Evolução</h2>
          <span className="hint">média móvel do aproveitamento nas questões corrigidas</span>
        </div>
        <div className="chartband">
          <div className="figure">
            <EvolutionArea values={evo} />
          </div>
          <div className="readout">
            <div>
              <div className="tele">Aproveitamento atual</div>
              <div className="big" style={{ color: "var(--brand)" }}>
                {rollPct === null ? "—" : `${rollPct}%`}
              </div>
            </div>
            <div>
              <div className="tele">Amostra</div>
              <div className="big" style={{ fontSize: 30 }}>
                {totalQ}
              </div>
            </div>
            <div>
              <div className="tele">Sequência</div>
              <div className="big" style={{ fontSize: 30 }}>
                {streak}d
              </div>
            </div>
          </div>
        </div>
      </Band>

      {/* ---------- BANDA 4 — PENDÊNCIAS ---------- */}
      <Band i={3}>
        <div className="band-title">
          <h2>Fila de prioridade</h2>
          <span className="hint">o que decide seu próximo bloco de estudo</span>
        </div>
        <div className="urgent">
          {urgentes.map((u, i) => (
            <Link className={`row2 ${u.cls}`} href={u.href} key={i}>
              <span className="bar" />
              <span className="n">{u.n}</span>
              <span>
                <div className="t">{u.t}</div>
                <div className="d">{u.d}</div>
              </span>
              <ArrowRight size={17} style={{ color: "var(--text-faint)" }} />
            </Link>
          ))}
        </div>
      </Band>

      {/* ---------- BANDA 5 — DOMÍNIO ---------- */}
      <Band i={4}>
        <div className="band-title">
          <h2>Domínio por área</h2>
          <span className="hint">acerto relativo entre as quatro áreas do exame</span>
        </div>
        <div className="chartband">
          <div className="figure">
            <AreaRadar data={radar} />
          </div>
          <div className="readout">
            {AREA_ORDER.map((k) => {
              const v = stats[k] || { c: 0, t: 0 };
              const p = v.t ? pct(v.c, v.t) : null;
              return (
                <div key={k}>
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 650 }}>{AREA_LABELS[k]}</span>
                    <span className="tele">{p === null ? "sem amostra" : `${p}% · n=${v.t}`}</span>
                  </div>
                  <div className="progress">
                    <motion.span
                      initial={{ width: 0 }}
                      animate={{ width: `${p ?? 0}%` }}
                      transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Band>

      {/* ---------- BANDA 6 — FRÁGEIS ---------- */}
      {weak.length > 0 && (
        <Band i={5}>
          <div className="band-title">
            <h2>Conteúdos frágeis</h2>
            <span className="hint">menor aproveitamento medido, do pior para o melhor</span>
          </div>
          <div className="fragile">
            {weak.map((w) => (
              <div className="f" key={w.name}>
                <div className="p">{w.p}%</div>
                <div className="nm">{w.name}</div>
                <div className="sub">
                  {w.c}/{w.t} acertos
                </div>
              </div>
            ))}
          </div>
        </Band>
      )}

      {/* ---------- BANDA 7 — ATIVIDADE ---------- */}
      <Band i={6}>
        <div className="band-title">
          <h2>Consistência</h2>
          <span className="hint">volume diário nos últimos 90 dias</span>
        </div>
        <div className="weekGrid" style={{ maxWidth: "none" }}>
          {days.map((d) => (
            <div key={d.key} className={`dayCell ${d.lv}`} title={d.title} />
          ))}
        </div>
      </Band>

      {/* ---------- BANDA 8 — METAS ---------- */}
      <Band i={7}>
        <div className="band-title">
          <h2>Metas da semana</h2>
          <span className="hint">configuráveis; sem punição se você não bater</span>
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
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, pct(val, goals[key] || 1))}%` }}
                  transition={{ duration: 1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <div className="tele" style={{ marginTop: 7 }}>
                {val} de {goals[key]}
              </div>
            </div>
          </div>
        ))}
      </Band>
    </>
  );
}
