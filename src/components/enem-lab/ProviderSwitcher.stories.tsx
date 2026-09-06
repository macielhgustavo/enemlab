import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import ProviderSwitcher from "./ProviderSwitcher";

/**
 * Lê os providers registrados de verdade, então mostra ENEM e ITA com a
 * contagem real de edições. Não há mock: número de edição inventado numa
 * peça de documentação vira número inventado no produto.
 */
const meta: Meta<typeof ProviderSwitcher> = {
  title: "ENEM Lab/ProviderSwitcher",
  component: ProviderSwitcher,
};
export default meta;
type Story = StoryObj<typeof ProviderSwitcher>;

export const Padrao: Story = {
  render: () => (
    <div style={{ maxWidth: 240 }}>
      <ProviderSwitcher />
    </div>
  ),
};
