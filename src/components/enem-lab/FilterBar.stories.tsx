import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FilterBar, FilterChip, FilterGroup, QuestionStatusBadge } from "./FilterBar";

const meta: Meta = { title: "ENEM Lab/FilterBar" };
export default meta;
type Story = StoryObj;

/**
 * Chips em vez de selects: um select esconde as opções até você abrir, e o
 * Banco tinha cinco em fila — para saber o que dava para filtrar era preciso
 * abrir os cinco.
 */
export const Padrao: Story = {
  render: function Render() {
    const [area, setArea] = useState("all");
    const [status, setStatus] = useState("all");
    return (
      <FilterBar summary="178 de 180 questões" onClear={() => { setArea("all"); setStatus("all"); }}>
        <FilterGroup label="Área">
          {[["all", "Todas"], ["matematica", "Matemática"], ["linguagens", "Linguagens"]].map(
            ([v, l]) => (
              <FilterChip key={v} active={area === v} onClick={() => setArea(v)}>
                {l}
              </FilterChip>
            ),
          )}
        </FilterGroup>
        <FilterGroup label="Status">
          {[["all", "Todos"], ["unseen", "Nunca vi"], ["wrong", "Já errei"]].map(([v, l]) => (
            <FilterChip key={v} active={status === v} onClick={() => setStatus(v)}>
              {l}
            </FilterChip>
          ))}
        </FilterGroup>
      </FilterBar>
    );
  },
};

export const StatusDaQuestao: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <QuestionStatusBadge status="unseen" />
      <QuestionStatusBadge status="wrong" />
      <QuestionStatusBadge status="correct" />
      <QuestionStatusBadge status="srs" />
    </div>
  ),
};
