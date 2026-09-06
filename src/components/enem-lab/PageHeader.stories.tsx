import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./PageHeader";

const meta: Meta<typeof PageHeader> = { title: "ENEM Lab/PageHeader", component: PageHeader };
export default meta;
type Story = StoryObj<typeof PageHeader>;

/**
 * A escala é a diferença que este componente existe para permitir. Uma tela
 * de trabalho não precisa da abertura editorial da Home — e antes as duas
 * usavam o mesmo título de 46px.
 */
export const Escalas: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 48 }}>
      <PageHeader
        size="editorial"
        eyebrow="Centro de controle"
        title="Boa tarde."
        description="Sua próxima sessão já está pronta."
      />
      <PageHeader
        eyebrow="Módulo · acervo"
        title="Banco de questões"
        context={<Badge variant="accent">ENEM</Badge>}
        description="Filtre, selecione e monte um treino."
        meta={
          <>
            <span>178 visíveis</span>
            <span>0 selecionadas</span>
          </>
        }
        actions={<Button variant="primary" size="sm">Treinar selecionadas</Button>}
      />
    </div>
  ),
};

export const ComTrilha: Story = {
  render: () => (
    <PageHeader
      eyebrow="Resultado"
      title="ENEM 2023"
      crumbs={[{ label: "Histórico", href: "/history" }, { label: "ENEM 2023" }]}
      context={<Badge variant="info">sprint 15</Badge>}
      actions={<Button variant="primary" size="sm">Revisar questão a questão</Button>}
    />
  ),
};
