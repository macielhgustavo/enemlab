"use client";
import { useEffect, useState } from "react";
import { animate } from "motion/react";

// Número que "conta" ao aparecer.
export function AnimatedNumber({
  value,
  format,
  duration = 0.9,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, duration]);
  return <>{format ? format(display) : Math.round(display).toLocaleString("pt-BR")}</>;
}

// Anel de progresso circular (SVG, tema-aware).
export function Ring({
  value,
  size = 132,
  stroke = 12,
  children,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pctv = value === null ? 0 : Math.max(0, Math.min(100, value));
  const [offset, setOffset] = useState(circ);
  useEffect(() => {
    const controls = animate(circ, circ - (circ * pctv) / 100, {
      duration: 1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setOffset(v),
    });
    return () => controls.stop();
  }, [pctv, circ]);

  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}
