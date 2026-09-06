"use client";
import * as React from "react";
import { Progress as P } from "radix-ui";
import { cn } from "@/lib/cn";

/**
 * Barra de progresso. `value` nulo significa indeterminado — e é anunciado
 * como tal, em vez de fingir 0%.
 */
export function Progress({
  value,
  className,
  label,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof P.Root>, "value"> & {
  value: number | null;
  label?: string;
}) {
  const v = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <P.Root
      className={cn("el-progress", className)}
      value={v}
      aria-label={label}
      {...props}
    >
      <P.Indicator
        className="el-progress__bar"
        style={{ width: v === null ? "35%" : `${v}%` }}
        data-indeterminate={v === null ? "" : undefined}
      />
    </P.Root>
  );
}
