import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Download, Play } from "lucide-react";
import { Button } from "./button";

const meta: Meta<typeof Button> = {
  title: "Base/Button",
  component: Button,
  args: { children: "Iniciar sessão" },
};
export default meta;

type Story = StoryObj<typeof Button>;

/**
 * A hierarquia inteira numa tela: só `primary` brilha. Se duas variantes
 * disputarem atenção lado a lado, a escolha está errada.
 */
export const Variantes: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <Button {...args} variant="primary" />
      <Button {...args} variant="secondary" />
      <Button {...args} variant="outline" />
      <Button {...args} variant="ghost" />
      <Button {...args} variant="danger">
        Apagar dados
      </Button>
    </div>
  ),
};

export const Tamanhos: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <Button {...args} size="sm" />
      <Button {...args} size="md" />
      <Button {...args} size="lg" />
      <Button size="icon" variant="ghost" aria-label="Baixar">
        <Download size={16} />
      </Button>
    </div>
  ),
};

export const ComIcone: Story = {
  args: { variant: "primary" },
  render: (args) => (
    <Button {...args}>
      <Play size={16} /> Iniciar sessão
    </Button>
  ),
};

/**
 * Em espera o rótulo some e entra um giro — a largura não muda, então a
 * página não pula no meio da ação. `aria-busy` avisa quem não vê a tela.
 */
export const Carregando: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button {...args} variant="primary" loading />
      <Button {...args} variant="secondary" loading />
    </div>
  ),
};

export const Desabilitado: Story = {
  render: (args) => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button {...args} variant="primary" disabled />
      <Button {...args} variant="secondary" disabled />
    </div>
  ),
};
