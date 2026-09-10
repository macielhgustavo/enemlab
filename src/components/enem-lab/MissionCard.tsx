import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/**
 * Cartão da próxima ação da Home.
 *
 * É o único bloco da tela com destaque forte, e é de propósito: se tudo
 * chama atenção, o aluno não sabe por onde começar.
 */
export function MissionCard({
  eyebrow,
  title,
  description,
  action,
  aside,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card variant="raised" padding="lg" className={cn("el-mission", className)}>
      <div className="el-mission__body">
        <div className="label el-mission__eyebrow">{eyebrow}</div>
        <h2 className="heading-lg">{title}</h2>
        {description && <p className="body-sm el-mission__desc">{description}</p>}
        {action && <div className="el-mission__action">{action}</div>}
      </div>
      {aside && <div className="el-mission__aside">{aside}</div>}
    </Card>
  );
}
