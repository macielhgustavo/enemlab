import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Bloco de carregamento.
 *
 * Fica escondido de leitor de tela: a região que carrega deve anunciar o
 * estado uma vez (aria-busy), não recitar dez retângulos.
 */
export function Skeleton({
  className,
  width,
  height,
  radius,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("el-skeleton", className)}
      style={{ width, height, borderRadius: radius, ...props.style }}
      {...props}
    />
  );
}
