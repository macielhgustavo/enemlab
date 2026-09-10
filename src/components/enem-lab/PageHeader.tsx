import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Cabeçalho de página.
 *
 * Substitui o `PageHead` antigo, que só tinha sobrancelha/título/sub e
 * mandava tudo no mesmo tamanho — o Banco abria com o mesmo título de 46px
 * da Home, e uma tela de trabalho não precisa de abertura editorial.
 *
 * `size` resolve isso: `page` para telas utilitárias, `editorial` para a
 * Home. É a densidade do documento, não uma preferência.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  crumbs,
  meta,
  context,
  size = "page",
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: Crumb[];
  /** Fatos curtos sobre a tela: contagens, período, origem. */
  meta?: React.ReactNode;
  /** Qual prova este conteúdo representa. Fica ao lado do título. */
  context?: React.ReactNode;
  size?: "page" | "editorial";
  className?: string;
}) {
  return (
    <header className={cn("el-head", `el-head--${size}`, className)}>
      {crumbs && crumbs.length > 0 && (
        <nav className="el-head__crumbs" aria-label="Trilha de navegação">
          <ol>
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`}>
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <ChevronRight size={13} aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="el-head__row">
        <div className="el-head__main">
          {eyebrow && <div className="label el-head__eyebrow">{eyebrow}</div>}
          <div className="el-head__titleline">
            <h1 className={size === "editorial" ? "display" : "heading-xl"}>{title}</h1>
            {context}
          </div>
          {description && <p className="body el-head__desc">{description}</p>}
          {meta && <div className="el-head__meta caption">{meta}</div>}
        </div>
        {actions && <div className="el-head__actions">{actions}</div>}
      </div>
    </header>
  );
}
