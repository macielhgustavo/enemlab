import type { StorybookConfig } from "@storybook/nextjs-vite";

/**
 * Storybook do design system.
 *
 * Só stories da camada de componentes: o Storybook documenta os blocos, não
 * as páginas. Página inteira depende de store, rota e rede — isso é assunto
 * do Playwright.
 */
const config: StorybookConfig = {
  stories: ["../src/components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "@storybook/nextjs-vite",
    options: {},
  },
  staticDirs: ["../public"],
};

export default config;
