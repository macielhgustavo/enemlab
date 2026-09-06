import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Flame, Target, TrendingUp } from "lucide-react";
import { MetricCard } from "./MetricCard";

const meta: Meta<typeof MetricCard> = {
  title: "ENEM Lab/MetricCard",
  component: MetricCard,
  args: { label: "Taxa de acerto", value: 67, unit: "%" },
};
export default meta;
type Story = StoryObj<typeof MetricCard>;

export const Padrao: Story = {};

export const Grade: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
      <MetricCard label="Sessões realizadas" value={12} icon={<TrendingUp size={14} />} tone="accent" />
      <MetricCard label="Taxa de acerto" value={67} unit="%" icon={<Target size={14} />} />
      <MetricCard label="Dias em sequência" value={4} icon={<Flame size={14} />} tone="warning" />
    </div>
  ),
};

/**
 * A razão de este componente existir.
 *
 * `value={null}` mostra travessão, não zero. Um painel que exibe "0%" para
 * quem nunca respondeu nada está afirmando que a pessoa errou tudo.
 */
export const SemAmostra: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
      <MetricCard label="Taxa de acerto" value={null} unit="%" hint="Corrija um treino para calcular" />
      <MetricCard label="Taxa de acerto" value={0} unit="%" hint="Zero de verdade: 0 de 20" />
    </div>
  ),
};
