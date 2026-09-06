"use client";
import { useEffect, useState } from "react";

/**
 * Contagem de entrada de `from` até `to`.
 *
 * Duas coisas já deram errado aqui, e as duas colocaram número errado na tela:
 * o `animate` imperativo do motion não disparava no browser (o anel ficava
 * vazio e os indicadores travados em zero), e guardar o valor exibido em
 * estado deixava o painel um passo atrás — ao trocar de prova, o ENEM mostrava
 * o número do ITA. Por isso o valor corrente nunca sai de estado: o estado
 * guarda apenas o *progresso* da animação, e o alvo é sempre lido da prop.
 *
 * Consequência deliberada: a contagem é um efeito de entrada. Trocar de prova
 * troca o número na hora, sem reanimar. Atrasar o enfeite é aceitável; exibir
 * o dado de outra prova, não.
 */
function useTween(from: number, to: number, seconds: number): number {
  const alvo = Number.isFinite(to) ? to : 0;
  const inicio = Number.isFinite(from) ? from : 0;
  const [entrada] = useState(alvo);
  // `null` = nenhum quadro rodou ainda. Distingue "não começou" de "está no
  // quadro zero": sem isso, um ambiente sem rAF exibiria o valor inicial para
  // sempre — que foi exatamente o defeito anterior.
  const [progresso, setProgresso] = useState<number | null>(null);

  useEffect(() => {
    const ms = Math.max(0, seconds * 1000);
    let raf = 0;
    let t0 = 0;
    const passo = (t: number) => {
      if (!t0) t0 = t;
      // Duração zero assenta no primeiro quadro em vez de dividir por zero.
      const p = ms <= 0 ? 1 : Math.min(1, (t - t0) / ms);
      // easeOutQuint: arranca rápido e assenta no fim.
      setProgresso(1 - Math.pow(1 - p, 5));
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [seconds]);

  if (alvo !== entrada || progresso === null || progresso >= 1) return alvo;
  return inicio + (alvo - inicio) * progresso;
}

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
  const display = useTween(0, value, duration);
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
  const offset = useTween(circ, circ - (circ * pctv) / 100, 1);

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
