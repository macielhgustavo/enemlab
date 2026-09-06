import * as React from "react";
import { AlertTriangle, Inbox, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

/**
 * Estados de vazio, erro e carregamento.
 *
 * Três telas diferentes que dizem "sem dados" de três jeitos diferentes é o
 * mesmo defeito de um cartão diferente por página. Estes são o jeito único.
 *
 * Vazio não é erro: quem ainda não estudou nada precisa de um caminho, não
 * de um aviso.
 */

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card variant="subtle" className={cn("el-state", className)}>
      <span className="el-state__icon" aria-hidden="true">
        {icon ?? <Inbox size={20} />}
      </span>
      <h3 className="heading-sm">{title}</h3>
      {description && <p className="body-sm el-state__desc">{description}</p>}
      {action && <div className="el-state__action">{action}</div>}
    </Card>
  );
}

export function ErrorState({
  title = "Não foi possível carregar",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    // `alert` faz o leitor de tela anunciar na hora: erro que aparece calado
    // deixa quem não vê a tela esperando por conteúdo que não vem.
    <Card variant="danger" role="alert" className={cn("el-state", className)}>
      <span className="el-state__icon el-state__icon--danger" aria-hidden="true">
        <AlertTriangle size={20} />
      </span>
      <h3 className="heading-sm">{title}</h3>
      {description && <p className="body-sm el-state__desc">{description}</p>}
      {onRetry && (
        <div className="el-state__action">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw size={14} /> Tentar de novo
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Carregamento com forma parecida com a do conteúdo que vem.
 *
 * `aria-busy` na região e os blocos escondidos: o leitor de tela anuncia
 * "carregando" uma vez, em vez de listar retângulos.
 */
export function LoadingState({
  lines = 3,
  label = "Carregando",
  className,
}: {
  lines?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("el-stack", className)} style={{ gap: "var(--space-12)" }} aria-busy="true">
      <span className="el-visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={i === 0 ? 20 : 14} width={i === 0 ? "45%" : "100%"} />
      ))}
    </div>
  );
}

/** Aviso curto dentro de uma tela, sem virar modal. */
export function InlineNotice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger";
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div
      className={cn("el-notice", `el-notice--${tone}`, className)}
      role={tone === "info" ? undefined : "alert"}
    >
      <Icon size={15} aria-hidden="true" />
      <div className="body-sm">{children}</div>
    </div>
  );
}
