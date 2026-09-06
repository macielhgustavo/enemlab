"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Diálogo modal sobre o primitive do Radix: foco preso enquanto aberto,
 * devolvido ao gatilho no fechamento, Esc fecha e o resto da página fica
 * inerte para leitor de tela. Nada disso é reimplementável barato à mão.
 */
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  showClose = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof D.Content> & {
  /** Obrigatório: um diálogo sem nome acessível é anunciado como "dialog". */
  title: string;
  description?: string;
  showClose?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="el-overlay" />
      <D.Content className={cn("el-dialog", className)} {...props}>
        <div className="el-dialog__head">
          <D.Title className="heading-lg">{title}</D.Title>
          {showClose && (
            <D.Close className="el-btn el-btn--ghost el-btn--icon" aria-label="Fechar">
              <X size={16} />
            </D.Close>
          )}
        </div>
        {description ? (
          <D.Description className="body-sm el-dialog__desc">{description}</D.Description>
        ) : (
          // Sem descrição visível, o Radix ainda espera saber disso.
          <D.Description className="el-visually-hidden">{title}</D.Description>
        )}
        {children}
      </D.Content>
    </D.Portal>
  );
}
