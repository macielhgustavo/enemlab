import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Skeleton } from "./skeleton";

const meta: Meta<typeof Skeleton> = { title: "Base/Skeleton", component: Skeleton };
export default meta;
type Story = StoryObj<typeof Skeleton>;

/**
 * O esqueleto imita a forma do que vem. Bloco genérico no lugar de um
 * cartão faz a tela pular quando o conteúdo chega.
 */
export const FormaDeCartao: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
      <Skeleton height={20} width="45%" />
      <Skeleton height={14} />
      <Skeleton height={14} width="80%" />
      <Skeleton height={120} radius={14} />
    </div>
  ),
};
