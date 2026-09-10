"use client";
import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Botão do produto.
 *
 * Cor sólida destaca a ação principal; `secondary`, `outline` e `ghost`
 * compartilham estados discretos de borda e superfície.
 */
const buttonVariants = cva("el-btn", {
  variants: {
    variant: {
      primary: "el-btn--primary",
      secondary: "el-btn--secondary",
      outline: "el-btn--outline",
      ghost: "el-btn--ghost",
      danger: "el-btn--danger",
    },
    size: {
      sm: "el-btn--sm",
      md: "el-btn--md",
      lg: "el-btn--lg",
      icon: "el-btn--icon",
    },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renderiza no elemento filho (ex.: um <Link>) em vez de num <button>. */
  asChild?: boolean;
  /** Bloqueia o clique e anuncia a espera a leitores de tela. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, disabled, children, onClickCapture, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), loading && "is-loading", className)}
      // `asChild` pode renderizar um <a>, que não tem `disabled`.
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      aria-disabled={asChild && (disabled || loading) ? true : undefined}
      data-loading={loading ? "" : undefined}
      {...props}
      onClickCapture={(event) => {
        if (disabled || loading) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClickCapture?.(event);
      }}
    >
      {children}
    </Comp>
  );
});

export { buttonVariants };
