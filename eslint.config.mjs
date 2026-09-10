import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Artefatos de build: o do Storybook é JS minificado e gerava 10 mil
    // avisos que escondiam os problemas reais do código.
    "storybook-static/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
