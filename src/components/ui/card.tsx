import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Superfície padrão.
 *
 * `interactive` é para cartão que o usuário clica: ganha borda mais evidente
 * e sobe 1px no hover. Deslocamento maior faz a página tremer quando há uma
 * grade de cartões.
 */
const cardVariants = cva("el-card", {
  variants: {
    variant: {
      default: "",
      raised: "el-card--raised",
      subtle: "el-card--subtle",
      interactive: "el-card--interactive",
      danger: "el-card--danger",
      success: "el-card--success",
    },
    padding: {
      none: "el-card--p0",
      sm: "el-card--psm",
      md: "",
      lg: "el-card--plg",
    },
  },
  defaultVariants: { variant: "default", padding: "md" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, padding, ...props },
  ref,
) {
  return <div ref={ref} className={cn(cardVariants({ variant, padding }), className)} {...props} />;
});

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("el-card__header", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("heading-md", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("body-sm", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("el-card__footer", className)} {...props} />;
}

export { cardVariants };
