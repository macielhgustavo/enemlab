import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@/components/ui/button";
import { ResultSummary } from "./ResultSummary";

const meta: Meta<typeof ResultSummary> = {
  title: "ENEM Lab/ResultSummary",
  component: ResultSummary,
  args: {
    correct: 10,
    total: 15,
    blank: 0,
    items: [
      { label: "Tempo médio", value: "1m 07s" },
      { label: "Erros com certeza", value: 2, hint: "marcou certeza e errou" },
      { label: "Acertos por chute", value: 1 },
    ],
  },
};
export default meta;
type Story = StoryObj<typeof ResultSummary>;

export const Enem: Story = {
  args: {
    note: "Acertos brutos; não é a nota TRI oficial do ENEM.",
    actions: <Button variant="secondary" size="sm">Revisões</Button>,
  },
};

/**
 * A ressalva muda com a banca: o ITA não tem TRI, então citá-la ali
 * inventaria um conceito que a prova não usa.
 */
export const Ita: Story = {
  args: {
    correct: 32,
    total: 48,
    blank: 4,
    note: "Contagem simples de acertos, pelo gabarito oficial do ITA.",
  },
};
