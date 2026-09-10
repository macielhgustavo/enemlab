"use client";
import * as React from "react";
import { Select as S } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export const Select = S.Root;
export const SelectValue = S.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof S.Trigger>) {
  return (
    <S.Trigger className={cn("el-select__trigger", className)} {...props}>
      {children}
      <S.Icon asChild>
        <ChevronDown size={15} aria-hidden="true" />
      </S.Icon>
    </S.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentPropsWithoutRef<typeof S.Content>) {
  return (
    <S.Portal>
      <S.Content className={cn("el-select__content", className)} position={position} {...props}>
        <S.Viewport className="el-select__viewport">{children}</S.Viewport>
      </S.Content>
    </S.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof S.Item>) {
  return (
    <S.Item className={cn("el-select__item", className)} {...props}>
      <span className="el-menu__check" aria-hidden="true">
        <S.ItemIndicator>
          <Check size={14} />
        </S.ItemIndicator>
      </span>
      <S.ItemText>{children}</S.ItemText>
    </S.Item>
  );
}
