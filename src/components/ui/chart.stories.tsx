import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Activity } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { CHART_COLORS, ChartContainer, ChartEmpty, ChartLegend, ChartTooltip, chartTheme } from "./chart";

const meta: Meta = { title: "Base/Chart" };
export default meta;
type Story = StoryObj;

const dados = [62, 58, 67, 71, 69, 74, 78].map((v, i) => ({ i: i + 1, v }));

export const Area_: Story = {
  name: "Área com tema",
  render: () => (
    <>
      <ChartContainer label="Evolução do aproveitamento por sessão" height={240}>
        <AreaChart data={dados} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
          <CartesianGrid {...chartTheme.grid} />
          <XAxis dataKey="i" {...chartTheme.axis} />
          <YAxis domain={[0, 100]} {...chartTheme.axis} tickFormatter={(v) => `${v}%`} />
          <ChartTooltip />
          <Area type="monotone" dataKey="v" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.16} />
        </AreaChart>
      </ChartContainer>
      <ChartLegend items={[{ label: "Aproveitamento", color: CHART_COLORS[0] }]} />
    </>
  ),
};

/**
 * Vazio não é zero: uma curva reta no chão afirma que o desempenho foi zero,
 * quando o que houve foi ausência de medição.
 */
export const Vazio: Story = {
  render: () => (
    <ChartEmpty icon={<Activity size={22} />}>
      Ainda não há corrigidas suficientes para desenhar a curva. Ela aparece a partir de duas
      medições.
    </ChartEmpty>
  ),
};
