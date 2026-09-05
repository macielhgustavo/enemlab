"use client";
import { useMemo } from "react";

export interface LabNode {
  name: string;
  area: string;
  areaLabel: string;
  c: number;
  t: number;
  p: number | null;
  cls: "mastered" | "stable" | "weak" | "untested";
}

interface Placed extends LabNode {
  x: number;
  y: number;
  r: number;
  hx: number;
  hy: number;
}

const W = 940;
const H = 560;
const CX = W / 2;
const CY = H / 2;

// Códigos distintos: truncar o rótulo faria Natureza e Humanas virarem "CIÊ".
const AREA_CODE: Record<string, string> = {
  matematica: "MAT",
  "ciencias-natureza": "NAT",
  "ciencias-humanas": "HUM",
  linguagens: "LIN",
};

const FILL: Record<LabNode["cls"], string> = {
  mastered: "var(--brand)",
  stable: "var(--cyan)",
  weak: "var(--bad)",
  untested: "var(--node-line)",
};

/**
 * Layout radial determinístico: cada área vira um núcleo e seus conteúdos se
 * distribuem num arco ao redor dele. Determinístico de propósito — uma
 * simulação física faria o mapa "dançar" a cada render.
 */
function layout(nodes: LabNode[], areas: string[]) {
  const hubs: Record<string, { x: number; y: number; label: string }> = {};
  const step = (Math.PI * 2) / Math.max(1, areas.length);
  areas.forEach((a, i) => {
    const ang = -Math.PI / 2 + i * step;
    hubs[a] = {
      x: CX + Math.cos(ang) * 215,
      y: CY + Math.sin(ang) * 150,
      label: nodes.find((n) => n.area === a)?.areaLabel ?? a,
    };
  });

  const placed: Placed[] = [];
  areas.forEach((a, ai) => {
    const mine = nodes.filter((n) => n.area === a);
    if (!mine.length) return;
    const hub = hubs[a];
    const base = -Math.PI / 2 + ai * step;
    const spread = Math.PI * 0.8;
    mine.forEach((n, i) => {
      const t = mine.length === 1 ? 0 : i / (mine.length - 1) - 0.5;
      const ang = base + t * spread;
      const dist = 100 + (i % 2) * 36;
      placed.push({
        ...n,
        hx: hub.x,
        hy: hub.y,
        x: hub.x + Math.cos(ang) * dist,
        y: hub.y + Math.sin(ang) * dist * 0.8,
        r: Math.max(5, Math.min(19, 5 + Math.sqrt(n.t) * 2.3)),
      });
    });
  });
  return { placed, hubs };
}

export default function KnowledgeCanvas({
  nodes,
  areas,
  overall,
  selected,
  onSelect,
}: {
  nodes: LabNode[];
  areas: string[];
  overall: number | null;
  selected: string | null;
  onSelect: (n: LabNode) => void;
}) {
  const { placed, hubs } = useMemo(() => layout(nodes, areas), [nodes, areas]);

  return (
    <svg
      className="labgraph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="Mapa de conteúdos: cada nó é um conteúdo, o tamanho indica a amostra e a cor indica o domínio"
    >
      {areas.map((a, i) => {
        const h = hubs[a];
        if (!h) return null;
        return (
          <line
            key={`e-${a}`}
            className="edge in"
            x1={CX}
            y1={CY}
            x2={h.x}
            y2={h.y}
            style={{ animationDelay: `${i * 60}ms` }}
          />
        );
      })}

      {placed.map((n, i) => (
        <line
          key={`c-${n.name}`}
          className={`edge in ${selected === n.name ? "lit" : ""}`}
          x1={n.hx}
          y1={n.hy}
          x2={n.x}
          y2={n.y}
          style={{ animationDelay: `${240 + i * 14}ms` }}
        />
      ))}

      {areas.map((a, i) => {
        const h = hubs[a];
        if (!h) return null;
        return (
          <g
            key={`h-${a}`}
            className="in"
            style={{ animationDelay: `${140 + i * 70}ms`, transformOrigin: `${h.x}px ${h.y}px` }}
          >
            <circle className="hub" cx={h.x} cy={h.y} r={27} />
            <text className="hublabel" x={h.x} y={h.y + 3} textAnchor="middle">
              {AREA_CODE[a] ?? h.label.slice(0, 3).toUpperCase()}
            </text>
          </g>
        );
      })}

      {placed.map((n, i) => (
        <g
          key={n.name}
          className={`node in ${selected === n.name ? "sel" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={`${n.name}, ${n.p === null ? "sem amostra" : `${n.p}% de acerto em ${n.t} questões`}`}
          onClick={() => onSelect(n)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(n);
            }
          }}
          style={{ animationDelay: `${300 + i * 12}ms`, transformOrigin: `${n.x}px ${n.y}px` }}
        >
          <circle className="halo" cx={n.x} cy={n.y} r={n.r + 7} />
          <circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={FILL[n.cls]}
            fillOpacity={n.cls === "untested" ? 0.45 : 0.9}
            stroke="var(--node-line)"
          />
          {n.r >= 10 && (
            <text className="nlabel" x={n.x} y={n.y + n.r + 13} textAnchor="middle">
              {n.name.length > 17 ? `${n.name.slice(0, 16)}…` : n.name}
            </text>
          )}
        </g>
      ))}

      <g className="in" style={{ transformOrigin: `${CX}px ${CY}px` }}>
        <circle className="core" cx={CX} cy={CY} r={55} />
        <text className="coreval" x={CX} y={CY + 2} textAnchor="middle">
          {overall === null ? "—" : `${overall}%`}
        </text>
        <text className="corelbl" x={CX} y={CY + 21} textAnchor="middle">
          DOMÍNIO
        </text>
      </g>
    </svg>
  );
}
