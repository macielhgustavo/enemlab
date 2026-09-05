"use client";

// Gráfico de evolução (média móvel de acerto) em SVG, tema-aware via CSS vars.
export default function EvolutionChart({ values }: { values: number[] }) {
  const W = 760;
  const H = 210;
  const padL = 34;
  const padR = 12;
  const padB = 20;
  const padT = 10;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const y = (p: number) => padT + innerH - (p / 100) * innerH;
  const x = (i: number, n: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);

  const line =
    values.length >= 2
      ? values.map((v, i) => `${i ? "L" : "M"}${x(i, values.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
      : "";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--panel2)",
      }}
      role="img"
      aria-label="Evolução do aproveitamento"
    >
      {[25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line x1={padL} y1={y(p)} x2={W - padR} y2={y(p)} stroke="var(--line)" strokeWidth={1} />
          <text x={4} y={y(p) + 3} fontSize={11} fill="var(--muted)">
            {p}%
          </text>
        </g>
      ))}
      {line ? (
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth={3} strokeLinejoin="round" />
      ) : (
        <text x={W / 2} y={H / 2} fontSize={13} fill="var(--muted)" textAnchor="middle">
          Corrija algumas questões para ver a evolução.
        </text>
      )}
    </svg>
  );
}
