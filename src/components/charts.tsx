"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Radar as RadarIcon } from "lucide-react";
import { ChartContainer, ChartEmpty, chartTheme } from "@/components/ui/chart";

/**
 * Cores dos gráficos, direto dos tokens.
 *
 * Aqui havia uma tabela de hex duplicando o design system, e ela ficou para
 * trás: o eixo no tema claro ainda usava `#8aa39d`, o valor que reprovava
 * contraste AA e já tinha sido corrigido nos tokens. Duplicata de cor não
 * envelhece junto com o original.
 *
 * `var(--x)` funciona em atributo de apresentação de SVG, então o Recharts
 * recebe o token e a troca de tema acontece sem re-render.
 */
const c = {
  brand: "var(--accent-primary)",
  cyan: "var(--accent-info)",
  grid: "var(--border-subtle)",
  axis: "var(--text-muted)",
} as const;

function EmptyChart({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <ChartEmpty icon={icon} height={230}>
      {children}
    </ChartEmpty>
  );
}

// Forma mínima do payload do Recharts (readonly no tipo original).
interface TipProps {
  active?: boolean;
  payload?: readonly { value?: unknown; payload?: unknown }[];
  label?: unknown;
}

/** Evolução do aproveitamento (média móvel já calculada no domínio). */
export function EvolutionArea({ values }: { values: number[] }) {
  if (!values || values.length < 2) {
    return (
      <EmptyChart icon={<Activity size={24} />}>
        Ainda não há corrigidas suficientes para desenhar a curva. Ela aparece a partir de duas
        medições.
      </EmptyChart>
    );
  }
  const data = values.map((v, i) => ({ i: i + 1, v }));

  return (
    <ChartContainer
      height={230}
      label={`Evolução: ${values.length} medições. Última: ${Math.round(values[values.length - 1])}% de acerto.`}
    >
      {/* `left` era -22 e empurrava o eixo para fora da área desenhada:
            "100%" e "75%" apareciam cortados como "0%" e "5%". */}
      <AreaChart data={data} margin={{ top: 8, right: 6, left: -4, bottom: 0 }}>
        <CartesianGrid {...chartTheme.grid} />
        <XAxis {...chartTheme.axis} dataKey="i" minTickGap={28} tickMargin={8} />
        <YAxis
          domain={[0, 100]}
          {...chartTheme.axis}
          ticks={[0, 25, 50, 75, 100]}
          width={44}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "var(--border-strong)" }}
          content={(props) => {
            const { active, payload, label } = props as unknown as TipProps;
            if (!active || !payload?.length) return null;
            return (
              <div className="chart-tip">
                <b>Medição {String(label)}</b>
                <span className="v">{Math.round(Number(payload[0].value))}% de acerto</span>
              </div>
            );
          }}
        />
        <Area
          type="linear"
          dataKey="v"
          stroke={c.brand}
          strokeWidth={2}
          fill={c.brand}
          fillOpacity={0.06}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 4, fill: c.brand, stroke: "transparent" }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export interface RadarDatum {
  area: string;
  pct: number;
  n: number;
}

/** Radar de desempenho por área. Só plota áreas com amostra. */
export function AreaRadar({ data }: { data: RadarDatum[] }) {
  const withSample = data.filter((d) => d.n > 0);
  if (withSample.length < 3) {
    return (
      <EmptyChart icon={<RadarIcon size={24} />}>
        O radar precisa de pelo menos três áreas com questões respondidas. Você tem{" "}
        {withSample.length}.
      </EmptyChart>
    );
  }

  return (
    <ChartContainer
      height={260}
      label={`Desempenho por área: ${withSample.map((d) => `${d.area}, ${d.pct}% em ${d.n} questões`).join("; ")}.`}
    >
      <RadarChart data={withSample} outerRadius="72%">
        <PolarGrid stroke={c.grid} />
        <PolarAngleAxis dataKey="area" tick={{ fill: c.axis, fontSize: 10 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Tooltip
          isAnimationActive={false}
          content={(props) => {
            const { active, payload } = props as unknown as TipProps;
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as RadarDatum;
            return (
              <div className="chart-tip">
                <b>{p.area}</b>
                <span className="v">{p.pct}% de acerto</span>
                <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                  {p.n} questão(ões) medida(s)
                </div>
              </div>
            );
          }}
        />
        <Radar
          dataKey="pct"
          stroke={c.brand}
          strokeWidth={2}
          fill={c.brand}
          fillOpacity={0.08}
          isAnimationActive={false}
        />
      </RadarChart>
    </ChartContainer>
  );
}
