import * as React from "react";
import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { TooltipProvider } from "../src/components/ui/tooltip";
import "../src/app/globals.css";

/**
 * O tema do app é dirigido por `data-theme` no <html>, e não por classe no
 * componente. O decorator faz a mesma coisa que o app faz, para o que se vê
 * aqui ser o que se vê em produção.
 */
function MolduraDeTema({ tema, children }: { tema: string; children: React.ReactNode }) {
  React.useEffect(() => {
    document.documentElement.dataset.theme = tema;
  }, [tema]);

  return (
    <TooltipProvider delayDuration={280}>
      <div
        style={{
          background: "var(--bg-canvas)",
          color: "var(--text-primary)",
          padding: 24,
          minHeight: "100vh",
        }}
      >
        {children}
      </div>
    </TooltipProvider>
  );
}

// O decorator só escolhe o tema: o hook mora num componente de verdade, que
// é onde a regra dos hooks permite.
const comTema: Decorator = (Story, ctx) => (
  <MolduraDeTema tema={ctx.globals.theme === "light" ? "light" : "dark"}>
    <Story />
  </MolduraDeTema>
);

const preview: Preview = {
  decorators: [comTema],
  globalTypes: {
    theme: {
      description: "Tema",
      defaultValue: "dark",
      toolbar: {
        title: "Tema",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Escuro" },
          { value: "light", title: "Claro" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    // O addon roda o axe em cada story. Erro reprova; o resto fica visível
    // no painel para quem estiver trabalhando no componente.
    a11y: { test: "error" },
    viewport: {
      options: {
        mobile: { name: "Mobile 390", styles: { width: "390px", height: "844px" } },
        tablet: { name: "Tablet 768", styles: { width: "768px", height: "1024px" } },
        desktop: { name: "Desktop 1440", styles: { width: "1440px", height: "900px" } },
      },
    },
  },
};

export default preview;
