import * as React from "react";
import { Card } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/dash";
import { cn } from "@/lib/cn";

/**
 * Indicador numérico.
 *
 * Regra que este componente existe para impor: **sem amostra não é zero.**
 * Passe `value={null}` e ele mostra um travessão. Um painel que exibe "0%"
 * para quem nunca respondeu nada está mentindo sobre o desempenho da pessoa.
 */
export function MetricCard({
  label,
  value,
  unit,
  hint,
  format,
  icon,
  aside,
  tone = "default",
  className,
}: {
  label: string;
  /** `null` = ainda não há dado. Não é o mesmo que zero. */
  value: number | null;
  unit?: string;
  hint?: React.ReactNode;
  format?: (n: number) => string;
  icon?: React.ReactNode;
  /** Faixa à direita do número: sparkline, pontinhos de sequência. */
  aside?: React.ReactNode;
  tone?: "default" | "accent" | "warning" | "danger";
  className?: string;
}) {
  const semDado = value === null;

  return (
    <Card variant="raised" padding="sm" className={cn("el-metric", className)}>
      <div className="el-metric__top">
        <span className="label">{label}</span>
        {icon && (
          <span className={cn("el-metric__icon", `el-metric__icon--${tone}`)} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>

      <div className="el-metric__row">
        <div className="el-metric__value telemetry">
          {semDado ? (
            <span className="el-metric__empty" title="Ainda sem amostra">
              —
            </span>
          ) : (
            <>
              <AnimatedNumber value={value} format={format} />
              {unit && <span className="el-metric__unit">{unit}</span>}
            </>
          )}
        </div>
        {aside && <div className="el-metric__aside">{aside}</div>}
      </div>

      {hint && <div className="caption el-metric__hint">{hint}</div>}
    </Card>
  );
}
