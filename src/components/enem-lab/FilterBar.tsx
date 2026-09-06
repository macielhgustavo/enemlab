"use client";
import * as React from "react";
import { Check, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

/**
 * Barra de filtros.
 *
 * O Banco tinha cinco `<select>` nativos em fila, e um select esconde as
 * opções até você abrir: para saber o que dava para filtrar era preciso
 * abrir os cinco. Aqui as escolhas curtas ficam à vista como chips, e só o
 * que tem muitas opções (ano) continua em select.
 *
 * No celular tudo vai para um painel: filtro em fila espreme o conteúdo,
 * que é o que o usuário veio ver.
 */

export function FilterChip({
  active,
  children,
  count,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  count?: number;
}) {
  return (
    <button
      type="button"
      // `aria-pressed` em vez de só uma classe: sem isso, quem não vê a tela
      // não sabe qual filtro está ligado.
      aria-pressed={active}
      className={cn("el-chip", active && "el-chip--on")}
      {...props}
    >
      {active && <Check size={13} aria-hidden="true" />}
      {children}
      {count !== undefined && <span className="el-chip__count">{count}</span>}
    </button>
  );
}

/** Um grupo de chips com rótulo. Vira `radiogroup` quando é escolha única. */
export function FilterGroup({
  label,
  children,
  multiple = false,
}: {
  label: string;
  children: React.ReactNode;
  multiple?: boolean;
}) {
  return (
    <div className="el-filtergroup" role="group" aria-label={label}>
      <span className="label el-filtergroup__label">{label}</span>
      <div className={cn("el-filtergroup__items", multiple && "is-multiple")}>{children}</div>
    </div>
  );
}

export function FilterBar({
  children,
  summary,
  onClear,
  actions,
  className,
}: {
  children: React.ReactNode;
  /** Texto curto do que os filtros produziram: "178 visíveis". */
  summary?: React.ReactNode;
  onClear?: () => void;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("el-filterbar", className)}>
      {/* Desktop: tudo à vista. */}
      <div className="el-filterbar__inline">{children}</div>

      {/* Mobile: um botão só, e o resto num painel de baixo. */}
      <div className="el-filterbar__compact">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary" size="sm">
              <SlidersHorizontal size={14} /> Filtros
            </Button>
          </SheetTrigger>
          <SheetContent title="Filtros" side="bottom" className="el-filterbar__sheet">
            {children}
          </SheetContent>
        </Sheet>
      </div>

      <div className="el-filterbar__foot">
        {summary && <span className="caption el-filterbar__summary">{summary}</span>}
        {onClear && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X size={13} /> Limpar
          </Button>
        )}
        {actions && <div className="el-filterbar__actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Marcador de estado de uma questão na lista.
 *
 * As chaves são as que o domínio já usa (`unseen`/`wrong`/`correct`/`srs`).
 * Inventar um vocabulário próprio aqui obrigaria a traduzir na chamada — e
 * foi exatamente assim que a lista quebrou uma vez: um `as` escondeu que os
 * dois lados falavam palavras diferentes.
 */
export type QuestionStatus = "unseen" | "wrong" | "correct" | "srs";

const STATUS_BADGE: Record<QuestionStatus, { label: string; variant: "neutral" | "danger" | "success" | "info" }> = {
  unseen: { label: "Nunca vi", variant: "neutral" },
  wrong: { label: "Já errei", variant: "danger" },
  correct: { label: "Já acertei", variant: "success" },
  srs: { label: "No SRS", variant: "info" },
};

export function QuestionStatusBadge({ status }: { status: QuestionStatus }) {
  const item = STATUS_BADGE[status];
  // Status desconhecido não derruba a lista inteira.
  if (!item) return null;
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
