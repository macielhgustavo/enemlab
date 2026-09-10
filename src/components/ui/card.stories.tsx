import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

const meta: Meta<typeof Card> = {
  title: "Base/Card",
  component: Card,
};
export default meta;
type Story = StoryObj<typeof Card>;

export const Variantes: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
      <Card>
        <CardTitle>Padrão</CardTitle>
        <CardDescription>Superfície de conteúdo. É o caso comum.</CardDescription>
      </Card>
      <Card variant="raised">
        <CardTitle>Elevado</CardTitle>
        <CardDescription>Um degrau acima: painel dentro de painel.</CardDescription>
      </Card>
      <Card variant="subtle">
        <CardTitle>Discreto</CardTitle>
        <CardDescription>Borda tracejada, para vazio e área de largar.</CardDescription>
      </Card>
      <Card variant="interactive" role="button" tabIndex={0}>
        <CardTitle>Interativo</CardTitle>
        <CardDescription>Sobe 1px no hover. Focável pelo teclado.</CardDescription>
      </Card>
      <Card variant="success">
        <CardTitle>Sucesso</CardTitle>
        <CardDescription>Confirmação de estado.</CardDescription>
      </Card>
      <Card variant="danger">
        <CardTitle>Perigo</CardTitle>
        <CardDescription>Ação destrutiva ou falha.</CardDescription>
      </Card>
    </div>
  ),
};

export const ComEstrutura: Story = {
  render: () => (
    <Card variant="raised" style={{ maxWidth: 420 }}>
      <CardHeader>
        <div>
          <CardTitle>Sessão de hoje</CardTitle>
          <CardDescription>15 questões, cerca de 24 min.</CardDescription>
        </div>
      </CardHeader>
      <CardFooter>
        <Button variant="primary" size="sm">
          Começar
        </Button>
        <Button variant="ghost" size="sm">
          Depois
        </Button>
      </CardFooter>
    </Card>
  ),
};
