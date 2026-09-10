"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Painel lateral. É o mesmo primitive do Dialog — as garantias de foco são
 * idênticas, só a posição muda. No mobile entra pela base, que é onde o
 * polegar alcança.
 */
export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

export function SheetContent({
  className,
  children,
  title,
  side = "right",
  ...props
}: React.ComponentPropsWithoutRef<typeof D.Content> & {
  title: string;
  side?: "right" | "left" | "bottom";
}) {
  return (
    <D.Portal>
      <D.Overlay className="el-overlay" />
      <D.Content className={cn("el-sheet", `el-sheet--${side}`, className)} {...props}>
        <div className="el-dialog__head">
          <D.Title className="heading-md">{title}</D.Title>
          <D.Close className="el-btn el-btn--ghost el-btn--icon" aria-label="Fechar">
            <X size={16} />
          </D.Close>
        </div>
        <D.Description className="el-visually-hidden">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  );
}
