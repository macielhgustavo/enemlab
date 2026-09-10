import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, InlineNotice, LoadingState } from "./states";

const meta: Meta = { title: "ENEM Lab/Estados" };
export default meta;
type Story = StoryObj;

export const Vazio: Story = {
  render: () => (
    <EmptyState
      title="Nenhuma sessão ainda"
      description="Corrija um treino para o painel começar a medir seu desempenho."
      action={<Button variant="primary" size="sm">Montar treino</Button>}
    />
  ),
};

export const Erro: Story = {
  render: () => (
    <ErrorState
      description="A prova não pôde ser carregada. Verifique a conexão e tente de novo."
      onRetry={() => {}}
    />
  ),
};

export const Carregando: Story = { render: () => <LoadingState lines={4} /> };

export const Avisos: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <InlineNotice>Esta prova é digitalizada: o enunciado é lido no documento oficial.</InlineNotice>
      <InlineNotice tone="warning">Duas questões desta edição foram anuladas.</InlineNotice>
      <InlineNotice tone="danger">O gabarito desta edição não foi ingerido.</InlineNotice>
    </div>
  ),
};
