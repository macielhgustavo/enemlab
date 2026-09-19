import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Search } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
import { NumberField } from "./number-field";
import { Status, StatusIndicator, StatusLabel } from "./status";
import {
  Choicebox,
  ChoiceboxItem,
  ChoiceboxItemHeader,
  ChoiceboxItemTitle,
  ChoiceboxItemDescription,
  ChoiceboxIndicator,
} from "./choicebox";
import {
  Timeline,
  TimelineItem,
  TimelineIndicator,
  TimelineSeparator,
  TimelineTitle,
  TimelineContent,
} from "./timeline";

const meta: Meta = { title: "Studium Labs/Registry components" };
export default meta;
type Story = StoryObj;

export const SearchField: Story = {
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <InputGroup>
        <InputGroupAddon>
          <Search size={16} aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Buscar questões"
          placeholder="Buscar questões…"
        />
      </InputGroup>
    </div>
  ),
};

function GoalControl() {
  const [value, setValue] = useState("80");
  return (
    <div style={{ maxWidth: 240 }}>
      <label htmlFor="story-goal">Cobertura alvo %</label>
      <NumberField
        id="story-goal"
        label="Cobertura alvo %"
        min={0}
        max={100}
        value={value}
        onValueChange={setValue}
      />
    </div>
  );
}
export const GoalNumberField: Story = { render: () => <GoalControl /> };

export const SessionStates: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24 }}>
      {(["complete", "active", "waiting"] as const).map((status, index) => (
        <Status key={status} status={status}>
          <StatusIndicator />
          <StatusLabel>{["Concluída", "Em andamento", "Aguardando"][index]}</StatusLabel>
        </Status>
      ))}
    </div>
  ),
};

export const Palette: Story = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      {["bg", "surface-1", "brand", "brand-soft", "warn", "bad"].map((token) => (
        <div key={token}>
          <div
            style={{
              width: 80,
              height: 64,
              borderRadius: 6,
              background: `var(--${token})`,
              border: "1px solid var(--line)",
            }}
          />
          <span style={{ fontSize: 12 }}>{token}</span>
        </div>
      ))}
    </div>
  ),
};

export const StudyObjective: Story = {
  render: () => (
    <div style={{ maxWidth: 380 }}>
      <Choicebox defaultValue="balanced" aria-label="Objetivo do treino">
        {[
          {
            value: "balanced",
            title: "Balanceado",
            detail: "Revisões e novas questões na mesma sessão.",
          },
          {
            value: "recovery",
            title: "Recuperação",
            detail: "Prioriza os conteúdos que precisam de atenção.",
          },
        ].map((item) => (
          <ChoiceboxItem key={item.value} value={item.value}>
            <ChoiceboxItemHeader>
              <ChoiceboxItemTitle>{item.title}</ChoiceboxItemTitle>
              <ChoiceboxItemDescription>{item.detail}</ChoiceboxItemDescription>
            </ChoiceboxItemHeader>
            <ChoiceboxIndicator />
          </ChoiceboxItem>
        ))}
      </Choicebox>
    </div>
  ),
};

export const StudyCycle: Story = {
  render: () => (
    <div className="adaptive-plan">
      <Timeline value={1} orientation="horizontal">
        {["Revisar", "Recuperar", "Explorar"].map((title, index) => (
          <TimelineItem key={title} step={index + 1}>
            <TimelineSeparator />
            <TimelineIndicator />
            <TimelineTitle>{title}</TimelineTitle>
            <TimelineContent>Etapa do ciclo de estudo.</TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  ),
};
