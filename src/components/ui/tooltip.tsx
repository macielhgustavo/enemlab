"use client";
import * as React from "react";
import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/cn";

export const TooltipProvider = T.Provider;
export const Tooltip = T.Root;
export const TooltipTrigger = T.Trigger;

export function TooltipContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentPropsWithoutRef<typeof T.Content>) {
  return (
    <T.Portal>
      <T.Content sideOffset={sideOffset} className={cn("el-tooltip", className)} {...props} />
    </T.Portal>
  );
}

/**
 * Tooltip de uma linha, para o caso comum.
 *
 * Só complementa — nunca carrega informação que só existe ali: tooltip não
 * abre no toque, então no celular o conteúdo simplesmente não existiria.
 */
export function Hint({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
