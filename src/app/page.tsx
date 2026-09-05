"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Play, ArrowUpRight } from "lucide-react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { pct } from "@/lib/format";
import { AREA_LABELS, AREA_ORDER, CONTENTS } from "@/lib/domain/constants";
import {
  masteryStats,
  contentMasteryState,
  weakestContents,
  evolutionSeries,
  streakDays,
  officialRows,
  wilsonInterval,
} from "@/lib/domain/stats";
import { dueSRS } from "@/lib/domain/srs";
import KnowledgeCanvas, { type LabNode } from "@/components/KnowledgeCanvas";
import { AnimatedNumber } from "@/components/dash";
import { Sk } from "@/components/Skeleton";

// content → área, a partir da taxonomia do provider.
function areaOfContent(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [area, list] of Object.entries(CONTENTS)) {
    for (const name of list) map[name] = area;
  }
  return map;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "10px 0" }}>
        Sinal insuficiente — a curva aparece a partir de duas medições.
      </div>
    );
  }
  const w = 200;
  const h = 44;
  const max = 100;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 44 }} aria-hidden="true">
      <motion.polyline
        points={pts}
        fill="none"
        stroke="var(--brand)"
        strokeWidth={1.6}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}

export default function BancadaPage() {
  const db = useStore((s) => s.db);
  const hydrated = useHydrated();
  const [sel, setSel] = useState<LabNode | null>(null);

  const nodes = useMemo(() => {
    if (!hydrated) return [];
    const stats = masteryStats(db);
    const owner = areaOfContent();
    const out: LabNode[] = [];
    for (const area of AREA_ORDER) {
      const mine = Object.entries(stats)
        .filter(([name]) => owner[name] === area)
        .map(([name, v]) => ({ name, v }))
        // Amostra primeiro: o mapa mostra o que foi medido.
        .sort((a, b) => b.v.t - a.v.t)
        .slice(0, 7);
      for (const { name, v } of mine) {
        const st = contentMasteryState(db, name, v);
        out.push({
          name,
          area,
          areaLabel: AREA_LABELS[area] || area,
          c: v.c,
          t: v.t,
          p: v.t ? pct(v.c, v.t) : null,
          cls: st.cls,
        });
      }
    }
    return out;
  }, [db, hydrated]);

  if (!hydrated) {
    return (
      <div className="lab">
        <Sk h={520} r={18} />
      </div>
    );
  }

  const due = dueSRS(db);
  const weak = weakestContents(db, 3);
  const evo = evolutionSeries(db);
  const streak = streakDays(db);
  const rows = officialRows(db).filter((x) => x.correct);
  const totalQ = rows.length;
  const overall = totalQ ? pct(rows.filter((x) => x.isCorrect).length, totalQ) : null;
  const inProg = db.attempts.find((a) => !a.finishedAt);

  const foco = sel ?? (weak.length ? nodes.find((n) => n.name === weak[0].name) ?? null : null);
  const ci = foco ? wilsonInterval(foco.c, foco.t) : null;

  const exp = inProg
    ? { k: "sessão aberta", what: `ENEM ${inProg.year}`, meta: `${Object.keys(inProg.answers || {}).length}/${inProg.questionRefs.length} respondidas`, href: `/exam/${inProg.id}`, cta: "Retomar" }
    : due.length
      ? { k: "retenção", what: `${due.length} revisão${due.length > 1 ? "ões" : ""}`, meta: "Fila de repetição espaçada vencida", href: "/srs", cta: "Revisar" }
      : weak.length
        ? { k: "conteúdo frágil", what: weak[0].name, meta: `${weak[0].p}% em ${weak[0].t} questões`, href: "/plano", cta: "Iniciar" }
        : { k: "calibração", what: "Primeiro sprint", meta: "15 questões alimentam o motor adaptativo", href: "/practice", cta: "Iniciar" };

  return (
    <div className="lab labstack">
      {/* Experimento de hoje — ação dominante */}
      <motion.div
        className="panel panel-float p-tl exp order-exp"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="ptitle">Experimento de hoje · {exp.k}</div>
        <div className="what">{exp.what}</div>
        <div className="meta">{exp.meta}</div>
        <Link className="run" href={exp.href}>
          <Play size={15} fill="currentColor" /> {exp.cta}
        </Link>
      </motion.div>

      {/* Inspetor do nó */}
      <motion.div
        className="panel panel-float p-tr insp order-insp"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="ptitle">Inspetor</div>
        {foco ? (
          <>
            <div className="nm">{foco.name}</div>
            <div className="big" style={{ color: foco.p !== null && foco.p < 60 ? "var(--bad)" : "var(--text)" }}>
              {foco.p === null ? "—" : <AnimatedNumber value={foco.p} format={(n) => `${Math.round(n)}%`} />}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
              {foco.areaLabel} · n = {foco.t}
            </div>
            {ci && foco.t > 0 && (
              <>
                <div className="ci">
                  <motion.span
                    initial={{ left: "50%", width: 0 }}
                    animate={{ left: `${ci.low}%`, width: `${Math.max(2, ci.high - ci.low)}%` }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 5 }}>
                  IC 95% · {ci.low}–{ci.high}
                </div>
              </>
            )}
            <div className="acts">
              <Link href="/plano">Treinar este conteúdo</Link>
              <Link href="/mastery">Ver no mapa completo</Link>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>
            Nenhum conteúdo medido ainda. Rode um experimento e os nós aparecem aqui.
          </div>
        )}
      </motion.div>

      {/* Fila de revisão */}
      <motion.div
        className="panel panel-float order-queue"
        style={{ left: 26, bottom: 92, width: 236 }}
        initial={{ opacity: 0, x: -14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="ptitle">Fila</div>
        {due.length ? (
          due.slice(0, 3).map((d) => (
            <Link className="qline" href="/srs" key={d.key}>
              <b>1</b>
              <span>{d.content || d.area}</span>
              <em>vencida</em>
            </Link>
          ))
        ) : weak.length ? (
          weak.slice(0, 3).map((w) => (
            <Link className="qline" href="/plano" key={w.name}>
              <b>{w.p}%</b>
              <span>{w.name}</span>
              <em>frágil</em>
            </Link>
          ))
        ) : (
          <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Nada na fila.</div>
        )}
      </motion.div>

      {/* Evolução */}
      <motion.div
        className="panel panel-float p-br order-evo"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="row between" style={{ marginBottom: 4 }}>
          <span className="ptitle" style={{ margin: 0 }}>
            Evolução
          </span>
          <Link href="/history" aria-label="Abrir histórico" style={{ color: "var(--text-faint)", display: "flex" }}>
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <Sparkline values={evo} />
        <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}>
          {totalQ} questões medidas · {streak}d de sequência
        </div>
      </motion.div>

      {/* O canvas */}
      <div className="order-graph">
        {nodes.length ? (
          <KnowledgeCanvas
            nodes={nodes}
            areas={AREA_ORDER}
            overall={overall}
            selected={foco?.name ?? null}
            onSelect={setSel}
          />
        ) : (
          <div
            style={{
              minHeight: 460,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              color: "var(--muted)",
            }}
          >
            <div style={{ maxWidth: 340 }}>
              <div className="ptitle">Mapa vazio</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                O mapa se desenha a partir das suas questões corrigidas. Rode o primeiro
                experimento e os conteúdos aparecem como nós ligados às áreas.
              </p>
              <Link className="run" href="/practice" style={{ display: "inline-flex", marginTop: 4 }}>
                <Play size={15} fill="currentColor" /> Montar experimento
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
