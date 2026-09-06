import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Primitives de layout.
 *
 * Existem para tirar `style={{ display:'flex', gap:12 }}` de dentro das
 * telas. Espaçamento vem da escala de tokens: quem precisa de 13px está
 * resolvendo o problema errado.
 */

type Space = 4 | 8 | 12 | 16 | 24 | 32 | 48 | 64;

const gapVar = (g?: Space) => (g === undefined ? undefined : `var(--space-${g})`);

/** Coluna. O empilhamento padrão de qualquer tela. */
export function Stack({
  gap,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { gap?: Space }) {
  return (
    <div
      className={cn("el-stack", className)}
      // Sem `gap` explícito, herda a densidade do container.
      style={{ gap: gap === undefined ? "var(--density-gap)" : gapVar(gap), ...style }}
      {...props}
    />
  );
}

/** Linha que quebra sozinha. Para grupos de botões, badges e filtros. */
export function Cluster({
  gap = 8,
  align = "center",
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { gap?: Space; align?: React.CSSProperties["alignItems"] }) {
  return (
    <div
      className={cn("el-cluster", className)}
      style={{ gap: gapVar(gap), alignItems: align, ...style }}
      {...props}
    />
  );
}

/**
 * Grade que se adapta sozinha: as colunas cabem conforme a largura, sem
 * media query por tela. `min` é a largura mínima aceitável de um item.
 */
export function Grid({
  min = 240,
  gap = 16,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { min?: number; gap?: Space }) {
  return (
    <div
      className={cn("el-grid", className)}
      style={{
        gap: gapVar(gap),
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
        ...style,
      }}
      {...props}
    />
  );
}

/** Bloco de conteúdo com título opcional. */
export function Section({
  title,
  description,
  action,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn("el-section", className)} {...props}>
      {(title || action) && (
        <div className="el-section__head">
          <div>
            {title && <h2 className="heading-md">{title}</h2>}
            {description && <p className="body-sm el-section__desc">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Cabeçalho de página: sobrancelha, título e ação à direita. */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className={cn("el-pagehead", className)} {...props}>
      <div className="el-pagehead__main">
        {eyebrow && <div className="label">{eyebrow}</div>}
        <h1 className="heading-xl">{title}</h1>
        {description && <p className="body el-pagehead__desc">{description}</p>}
      </div>
      {action && <div className="el-pagehead__action">{action}</div>}
    </header>
  );
}

export type Density = "compact" | "default" | "spacious";

/**
 * Envelope de uma tela.
 *
 * `density` não é preferência do usuário: é uma decisão de projeto sobre
 * quanto ar aquele conteúdo merece. Uma lista de centenas de linhas e um
 * painel de três números não podem respirar igual, e antes respiravam —
 * porque a densidade só existia na documentação.
 *
 * O atributo redefine `--density-gap` e `--density-pad` para a subárvore
 * inteira, então componente novo herda sem precisar saber que isso existe.
 */
export function PageShell({
  className,
  width = "default",
  density = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  width?: "default" | "wide" | "narrow";
  density?: Density;
}) {
  return (
    <div
      className={cn("el-shell", `el-shell--${width}`, className)}
      data-density={density}
      {...props}
    />
  );
}
