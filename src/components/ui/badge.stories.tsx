import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "./badge";

const meta: Meta<typeof Badge> = { title: "Base/Badge", component: Badge };
export default meta;
type Story = StoryObj<typeof Badge>;

export const Variantes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Badge>neutro</Badge>
      <Badge variant="outline">contorno</Badge>
      <Badge variant="accent">ativo</Badge>
      <Badge variant="success">dominado</Badge>
      <Badge variant="warning">atenção</Badge>
      <Badge variant="danger">prioridade</Badge>
      <Badge variant="info">referência</Badge>
    </div>
  ),
};
