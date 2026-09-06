"use client";
import * as React from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/cn";

/**
 * Tema único para os gráficos.
 *
 * Continua sendo Recharts — o que muda é que grade, eixo, tooltip e cor
 * saem de um lugar só. Antes cada gráfico repetia `stroke="var(--line)"` e
 * um tooltip próprio, e bastava um esquecer para o painel ficar com dois
 * cinzas diferentes.
 *
 * Nada aqui inventa dado: sem série, o chamador mostra estado vazio.
 */

/**
 * Ordem de cores para séries categóricas.
 *
 * Verde primeiro porque é a cor do produto; ciano e violeta em seguida
 * porque se separam bem do verde tanto no escuro quanto no claro. Não é uma
 * paleta segura para daltonismo em série longa — com mais de três séries,
 * acrescente forma ou rótulo direto, não só cor.
 */
export const CHART_COLORS = [
  "var(--accent-primary)",
  "var(--accent-info)",
  "var(--accent-violet)",
] as const;

export const chartTheme = {
  grid: {
    stroke: "var(--border-subtle)",
    strokeDasharray: "3 6",
    vertical: false,
  },
  axis: {
    stroke: "var(--border-default)",
    tick: { fill: "var(--text-muted)", fontSize: 11 },
    tickLine: false,
    axisLine: false,
  },
} as const;

/** Tooltip com a superfície do design system, não a branca do Recharts. */
export function ChartTooltip({
  formatter,
  labelFormatter,
}: {
  formatter?: (value: number, name: string) => React.ReactNode;
  labelFormatter?: (label: string) => React.ReactNode;
}) {
  return (
    <Tooltip
      cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
      contentStyle={{
        background: "var(--bg-raised)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-sm)",
        boxShadow: "var(--shadow-lg)",
        fontSize: 12.5,
        padding: "8px 10px",
      }}
      labelStyle={{ color: "var(--text-muted)", marginBottom: 4 }}
      itemStyle={{ color: "var(--text-primary)" }}
      formatter={formatter as never}
      labelFormatter={labelFormatter as never}
    />
  );
}

/**
 * Envelope responsivo com altura explícita.
 *
 * O ResponsiveContainer do Recharts colapsa para zero quando o pai não tem
 * altura definida — e um gráfico de altura zero não avisa que sumiu.
 */
export function ChartContainer({
  height = 220,
  className,
  children,
  label,
}: {
  height?: number;
  className?: string;
  children: React.ReactElement;
  /** Descrição para quem não vê o gráfico. Um SVG sem isso é um buraco. */
  label: string;
}) {
  return (
    <div className={cn("el-chart", className)} style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Estado vazio de um gráfico.
 *
 * Gráfico sem dado não é gráfico com zero: uma curva reta no chão afirma que
 * o desempenho foi zero, quando o que houve foi ausência de medição.
 */
export function ChartEmpty({
  icon,
  children,
  height = 220,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <div className="el-chart__empty" style={{ minHeight: height }}>
      {icon && (
        <span className="el-chart__emptyicon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="body-sm">{children}</p>
    </div>
  );
}

/**
 * Legenda fora do SVG.
 *
 * Texto em `<text>` do SVG não herda a tipografia da página e não quebra
 * linha sozinho; em HTML, herda e quebra.
 */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="el-chart__legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className="el-chart__dot" style={{ background: i.color }} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
