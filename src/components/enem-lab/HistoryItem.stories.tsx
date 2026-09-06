import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HistoryItem } from "./HistoryItem";
import type { Attempt } from "@/lib/domain/types";

function tentativa(over: Partial<Attempt> = {}): Attempt {
  return {
    id: "a_story",
    providerId: "enem",
    year: 2023,
    mode: "sprint15",
    minutes: 30,
    elapsed: 1080,
    startedAt: "2026-03-12T10:00:00.000Z",
    finishedAt: "2026-03-12T10:18:00.000Z",
    result: { rows: [], correct: 11, total: 15, blank: 0 },
    ...over,
  } as unknown as Attempt;
}

const meta: Meta<typeof HistoryItem> = { title: "ENEM Lab/HistoryItem", component: HistoryItem };
export default meta;
type Story = StoryObj<typeof HistoryItem>;

/**
 * A faixa lateral muda de cor com o desempenho: dá para varrer a coluna sem
 * ler nenhum número. A banca vem sempre da tentativa — o histórico mistura
 * provas de propósito.
 */
export const Faixas: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 8 }}>
      <HistoryItem attempt={tentativa()} sessionId="session_2026-03-12_1" />
      <HistoryItem attempt={tentativa({ result: { rows: [], correct: 8, total: 15, blank: 1 } } as Partial<Attempt>)} />
      <HistoryItem attempt={tentativa({ result: { rows: [], correct: 4, total: 15, blank: 3 } } as Partial<Attempt>)} />
      <HistoryItem attempt={tentativa({ providerId: "ita", year: 2026, result: null, finishedAt: null } as Partial<Attempt>)} />
    </div>
  ),
};
