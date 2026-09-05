"use client";
import { useStore } from "@/lib/store";
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Radar as RadarIcon } from "lucide-react";

// Paletas espelhando os tokens do design system. Derivar do tema (em vez de
// ler o DOM) mantém a renderização pura e reage à troca de tema na hora.
const PALETTE = {
  dark: { brand: "#00e5a0", cyan: "#22d3ee", grid: "rgba(255,255,255,.07)", axis: "#4e6b6a" },
  light: { brand: "#00875f", cyan: "#0e8fa8", grid: "rgba(6,40,34,.11)", axis: "#8aa39d" },
} as const;

function useChartColors() {
  const theme = useStore((s) => s.db.theme);
  return PALETTE[theme === "light" ? "light" : "dark"];
}

function EmptyChart({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="empty" style={{ padding: "36px 20px" }}>
      <div className="empty-art" style={{ width: 58, height: 58, borderRadius: 16 }}>
        {icon}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
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
  const c = useChartColors();
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
    <div className="chartwrap" style={{ height: 230 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id="evoFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.brand} stopOpacity={0.42} />
              <stop offset="100%" stopColor={c.brand} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="i" tick={{ fill: c.axis, fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: c.axis, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            cursor={{ stroke: c.brand, strokeOpacity: 0.35 }}
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
            type="monotone"
            dataKey="v"
            stroke={c.brand}
            strokeWidth={2}
            fill="url(#evoFill)"
            isAnimationActive
            animationDuration={900}
            dot={false}
            activeDot={{ r: 4, fill: c.brand, stroke: "transparent" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface RadarDatum {
  area: string;
  pct: number;
  n: number;
}

/** Radar de desempenho por área. Só plota áreas com amostra. */
export function AreaRadar({ data }: { data: RadarDatum[] }) {
  const c = useChartColors();
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
    <div className="chartwrap" style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={withSample} outerRadius="72%">
          <PolarGrid stroke={c.grid} />
          <PolarAngleAxis dataKey="area" tick={{ fill: c.axis, fontSize: 10 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip
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
            fillOpacity={0.22}
            isAnimationActive
            animationDuration={900}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
