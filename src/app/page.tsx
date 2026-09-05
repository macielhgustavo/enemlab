"use client";
import Link from "next/link";
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
import EvolutionChart from "@/components/EvolutionChart";
import { AnimatedNumber, Ring } from "@/components/dash";
import { DashboardSkeleton } from "@/components/Skeleton";
import { Target, CheckCircle2, RotateCcw, Flame, Zap } from "lucide-react";

export default function HomePage() {
  const db = useStore((s) => s.db);
  const goals = db.goals;
  const setGoals = useStore((s) => s.setGoals);
  const hydrated = useHydrated();

  if (!hydrated) {
    return <DashboardSkeleton />;
  }

  const rows = officialRows(db).filter((x) => x.correct);
  const roll = rollingRows(db, 100);
  const rollPct = roll.length ? pct(roll.filter((x) => x.isCorrect).length, roll.length) : null;
  const due = dueSRS(db).length;
  const streak = streakDays(db);
  const inProg = db.attempts.find((a) => !a.finishedAt);
  const stats = areaStats(db);
  const weak = weakestContents(db, 3);
  const evo = evolutionSeries(db);

  // Recordes
  const completed = db.attempts.filter((a) => a.result);
  const best = completed.length
    ? Math.max(...completed.map((a) => pct(a.result!.correct, a.result!.total)))
    : 0;
  const longest = rows.reduce((b, _x, i, arr) => {
    let n = 0;
    for (let j = i; j < arr.length && arr[j].isCorrect; j++) n++;
    return Math.max(b, n);
  }, 0);

  // Dashboard: prontidão geral, nível (volume) e XP.
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

  return (
    <>
      <section className="dash-hero">
        <div className="dash-top">
          <div style={{ flex: 1, minWidth: 260 }}>
            <span className="pill">questões reais + aprendizagem adaptativa</span>
            <h1 style={{ marginTop: 12 }}>
              {streak > 0 ? `${streak} dia${streak > 1 ? "s" : ""} de foco.` : "Comece agora."}
            </h1>
            <p style={{ color: "var(--muted)", fontSize: 15.5, lineHeight: 1.6, maxWidth: 560 }}>
              {due > 0
                ? `Você tem ${due} revisão(ões) vencida(s). Comece pela retenção — rende mais que volume novo.`
                : "Abra e saiba exatamente o que estudar agora. O algoritmo recomenda; você decide."}
            </p>
            <div className="row" style={{ marginTop: 18 }}>
              <Link className="btn bigAction link-btn" href="/practice">
                Montar treino
              </Link>
              <Link className="btn ghost link-btn" href={due > 0 ? "/srs" : "/plano"}>
                {due > 0 ? "Revisões de hoje" : "Ver meu plano"}
              </Link>
              {streak > 0 && (
                <span className="streak-flame">
                  <Flame size={16} /> {streak}
                </span>
              )}
            </div>

            <div style={{ marginTop: 22, maxWidth: 420 }}>
              <div
                className="row between"
                style={{ fontSize: 12, marginBottom: 6, color: "var(--muted)" }}
              >
                <b style={{ color: "var(--text)" }}>Nível {level}</b>
                <span>
                  {xpInLevel}/{PER_LEVEL} questões p/ o próximo
                </span>
              </div>
              <div className="level-bar">
                <span style={{ width: `${(xpInLevel / PER_LEVEL) * 100}%` }} />
              </div>
            </div>
          </div>

          <Ring value={overall} size={148}>
            <b>{overall === null ? "—" : <AnimatedNumber value={overall} format={(n) => `${Math.round(n)}%`} />}</b>
            <small>domínio geral</small>
          </Ring>
        </div>
      </section>

      {inProg && (
        <Card className="continueCard" style={{ marginTop: 14 }}>
          <div>
            <span className="pill">continuar</span>
            <h2 style={{ marginTop: 7 }}>
              ENEM {inProg.year} • {inProg.mode}
            </h2>
            <div className="muted">
              {Object.keys(inProg.answers || {}).length}/{inProg.questionRefs.length} respondidas
            </div>
          </div>
          <Link className="btn bigAction link-btn" href={`/exam/${inProg.id}`}>
            Continuar →
          </Link>
        </Card>
      )}

      <div className="statline" style={{ marginTop: 14 }}>
        <div className="stat">
          <div className="ico">
            <Target size={18} />
          </div>
          <div className="val">
            {rollPct === null ? "—" : <AnimatedNumber value={rollPct} format={(n) => `${Math.round(n)}%`} />}
          </div>
          <div className="lbl">Últimas 100</div>
        </div>
        <div className="stat">
          <div className="ico">
            <CheckCircle2 size={18} />
          </div>
          <div className="val">
            <AnimatedNumber value={totalQ} />
          </div>
          <div className="lbl">Questões reais</div>
        </div>
        <div className="stat">
          <div className="ico">
            <RotateCcw size={18} />
          </div>
          <div className="val">
            <AnimatedNumber value={due} />
          </div>
          <div className="lbl">Revisões vencidas</div>
        </div>
        <div className="stat">
          <div className="ico">
            <Zap size={18} />
          </div>
          <div className="val">
            <AnimatedNumber value={streak} format={(n) => `${Math.round(n)}d`} />
          </div>
          <div className="lbl">Sequência</div>
        </div>
      </div>

      <Card style={{ marginTop: 14 }}>
        <div className="row between">
          <div>
            <h2>Evolução</h2>
            <div className="muted">média móvel das últimas questões corrigidas</div>
          </div>
          <span className="badge2">
            {rollPct === null ? "sem dados" : `${rollPct}%`}
          </span>
        </div>
        <div style={{ marginTop: 12 }}>
          <EvolutionChart values={evo} />
        </div>
      </Card>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <Card>
          <h2>Áreas</h2>
          {AREA_ORDER.map((k) => {
            const v = stats[k] || { c: 0, t: 0 };
            return <AreaBar key={k} name={AREA_LABELS[k]} c={v.c} t={v.t} />;
          })}
        </Card>
        <Card>
          <h2>Próximas ações</h2>
          <div className="studyBlock">
            <div className="prio">recomendação</div>
            <h3>{due ? `${due} revisão(ões) vencida(s)` : "Adaptive 15"}</h3>
            <div className="muted">
              {due
                ? "Comece pela retenção antes de buscar questões novas."
                : weak.length
                  ? `Conteúdos mais frágeis: ${weak.map((x) => x.name).join(", ")}.`
                  : "Faça um sprint para o algoritmo aprender seu perfil."}
            </div>
            <Link
              className="btn secondary link-btn"
              style={{ marginTop: 10 }}
              href={due ? "/srs" : "/practice"}
            >
              {due ? "Revisar agora" : "Gerar treino"}
            </Link>
          </div>
        </Card>
      </div>

      <div className="grid grid2" style={{ marginTop: 14 }}>
        <Card>
          <div className="row between">
            <div>
              <h2>Atividade</h2>
              <div className="muted">últimos 90 dias</div>
            </div>
            <span className="badge2">{streak} dia(s)</span>
          </div>
          <div className="weekGrid" style={{ marginTop: 13 }}>
            {days.map((d) => (
              <div key={d.key} className={`dayCell ${d.lv}`} title={d.title} />
            ))}
          </div>
        </Card>
        <Card>
          <h2>Recordes pessoais</h2>
          <div className="recordGrid">
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
              <small>Questões nesta semana</small>
              <b>{weekQ}</b>
            </div>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 14 }}>
        <div className="row between">
          <div>
            <h2>Metas da semana</h2>
            <div className="muted">Configuráveis; sem punição se você não bater.</div>
          </div>
        </div>
        {(
          [
            ["Questões", weekQ, "questions"],
            ["Redações", weekEss, "essays"],
            ["Revisões", weekRev, "reviews"],
          ] as const
        ).map(([name, val, key]) => (
          <div className="goalRow" key={key}>
            <b>{name}</b>
            <input
              type="number"
              min={0}
              value={goals[key]}
              onChange={(e) =>
                setGoals({ ...goals, [key]: Math.max(0, Number(e.target.value || 0)) })
              }
            />
            <div>
              <div className="goalProgress">
                <span style={{ width: `${Math.min(100, pct(val, goals[key] || 1))}%` }} />
              </div>
              <div className="muted" style={{ fontSize: 10 }}>
                {val}/{goals[key]}
              </div>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
