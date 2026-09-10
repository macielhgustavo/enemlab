import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva("el-badge", {
  variants: {
    variant: {
      neutral: "",
      accent: "el-badge--accent",
      success: "el-badge--success",
      warning: "el-badge--warning",
      danger: "el-badge--danger",
      info: "el-badge--info",
      outline: "el-badge--outline",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** Rótulo curto de estado. Não é botão: se clica, use Button. */
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
