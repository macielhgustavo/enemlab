import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
import { Badge } from "./badge";
import { Progress } from "./progress";
import { FilterChip } from "../enem-lab/FilterBar";

const meta: Meta = { title: "UI/Control consistency", parameters: { layout: "padded" } };
export default meta;
type Story = StoryObj;

function Controls() {
  return (
    <div className="el-stack" style={{ gap: "var(--space-24)", maxWidth: 600 }}>
      <div className="el-cluster" style={{ gap: "var(--space-8)" }}>
        <Button variant="primary">Começar</Button>
        <Button variant="secondary">Salvar</Button>
        <Button variant="ghost">Cancelar</Button>
        <Button disabled>Indisponível</Button>
        <Button loading>Salvando</Button>
      </div>
      <div>
        <label htmlFor="story-search">Buscar conteúdo</label>
        <input id="story-search" className="el-search" placeholder="Ex.: geometria" />
      </div>
      <div className="el-cluster" style={{ gap: "var(--space-8)" }}>
        <FilterChip active>Todos</FilterChip>
        <FilterChip count={12}>Não vistos</FilterChip>
        <Badge variant="success">Concluído</Badge>
        <Badge variant="warning">Pendente</Badge>
        <Badge variant="info">Informação</Badge>
        <Badge variant="danger">Erro</Badge>
      </div>
      <Tabs defaultValue="recent">
        <TabsList aria-label="Período">
          <TabsTrigger value="recent">Esta semana</TabsTrigger>
          <TabsTrigger value="all">Todo o período</TabsTrigger>
        </TabsList>
        <TabsContent value="recent">12 questões nesta semana.</TabsContent>
        <TabsContent value="all">128 questões no histórico.</TabsContent>
      </Tabs>
      <Progress value={67} label="Meta diária" />
    </div>
  );
}
export const Escuro: Story = { render: () => <Controls />, globals: { theme: "dark" } };
export const Claro: Story = { ...Escuro, globals: { theme: "light" } };
