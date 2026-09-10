import * as React from "react";
import { Card } from "@/components/ui/card";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

const metricVariants = cva("el-metric", {
  variants: { presentation: { surface: "", plain: "el-metric--plain" } },
  defaultVariants: { presentation: "surface" },
});
const iconVariants = cva("el-metric__icon", {
  variants: {
    tone: {
      default: "",
      accent: "el-metric__icon--accent",
      warning: "el-metric__icon--warning",
      danger: "el-metric__icon--danger",
    },
  },
});

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
  presentation = "surface",
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
  presentation?: "surface" | "plain";
  className?: string;
}) {
  const semDado = value === null;

  return (
    <Card padding="sm" className={cn(metricVariants({ presentation }), className)}>
      <div className="el-metric__top">
        <span className="label">{label}</span>
        {icon && (
          <span className={iconVariants({ tone })} aria-hidden="true">
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
              <span>{format ? format(value) : value.toLocaleString("pt-BR")}</span>
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
