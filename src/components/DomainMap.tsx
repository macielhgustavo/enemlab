"use client";

export interface AreaPoint {
  id: string;
  label: string;
  pct: number | null;
  n: number;
}

const W = 340;
const H = 250;
const CX = W / 2;
const CY = H / 2 - 4;

/**
 * Distribui os nós em círculo, começando no topo.
 *
 * Antes eram quatro posições fixas, o que servia às quatro áreas do ENEM e
 * descartava em silêncio a quinta matéria do ITA. Um mapa de domínio que
 * esconde uma matéria é pior que um mapa apertado.
 */
function slotsFor(n: number) {
  const rx = 100;
  const ry = 78;
  return Array.from({ length: n }, (_, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const y = CY + ry * Math.sin(ang);
    return {
      x: CX + rx * Math.cos(ang),
      y,
      anchor: "middle" as const,
      // Rótulo acima do nó na metade de cima, abaixo na metade de baixo.
      dy: y < CY - 1 ? -30 : 40,
    };
  });
}

/** Estado por faixa de acerto — a mesma leitura da legenda. */
function tone(pct: number | null): { fill: string; label: string } {
  if (pct === null) return { fill: "var(--line-strong)", label: "sem amostra" };
  if (pct >= 75) return { fill: "var(--brand)", label: "forte" };
  if (pct >= 65) return { fill: "var(--info)", label: "em evolução" };
  if (pct >= 50) return { fill: "var(--warn)", label: "atenção" };
  return { fill: "var(--bad)", label: "prioridade" };
}

export default function DomainMap({ areas, hub }: { areas: AreaPoint[]; hub: string }) {
  // Todas as áreas da prova entram: o layout se adapta à quantidade.
  const pts = areas;
  const slots = slotsFor(pts.length);

  return (
    <>
      <svg
        className="dmap"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Mapa de domínio por área: ${pts
          .map((a) => `${a.label} ${a.pct === null ? "sem amostra" : `${a.pct}%`}`)
          .join(", ")}`}
      >
        <circle className="hubc" cx={CX} cy={CY} r={78} strokeDasharray="2 5" />
        <circle className="hubc" cx={CX} cy={CY} r={52} />

        {pts.map((a, i) => {
          const s = slots[i];
          if (!s) return null;
          return <line key={`l-${a.id}`} className="link" x1={CX} y1={CY} x2={s.x} y2={s.y} />;
        })}

        <circle cx={CX} cy={CY} r={26} fill="var(--panel-solid)" stroke="var(--line-strong)" />
        <text className="hublbl" x={CX} y={CY + 3} textAnchor="middle">
          {hub}
        </text>

        {pts.map((a, i) => {
          const s = slots[i];
          if (!s) return null;
          const t = tone(a.pct);
          const up = s.dy < 0;
          return (
            <g key={a.id} className="in" style={{ animationDelay: `${120 + i * 90}ms` }}>
              <circle cx={s.x} cy={s.y} r={19} fill={t.fill} fillOpacity={0.18} />
              <circle cx={s.x} cy={s.y} r={12} fill={t.fill} />
              <circle cx={s.x - 3.5} cy={s.y - 4} r={3.6} fill="#fff" fillOpacity={0.42} />
              <text className="anm" x={s.x} y={s.y + (up ? -32 : 34)} textAnchor={s.anchor}>
                {a.label}
              </text>
              <text
                className="apc"
                x={s.x}
                y={s.y + (up ? -14 : 52)}
                textAnchor={s.anchor}
                fill={t.fill}
              >
                {a.pct === null ? "—" : `${a.pct}%`}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="dlegend">
        <span>
          <i style={{ background: "var(--brand)" }} /> Forte
        </span>
        <span>
          <i style={{ background: "var(--info)" }} /> Em evolução
        </span>
        <span>
          <i style={{ background: "var(--warn)" }} /> Atenção
        </span>
        <span>
          <i style={{ background: "var(--bad)" }} /> Prioridade
        </span>
      </div>
    </>
  );
}
