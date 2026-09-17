import type { Meta, StoryObj } from "@storybook/react";
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
