"use client";
import * as React from "react";
import { DropdownMenu as M } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  align = "end",
  ...props
}: React.ComponentPropsWithoutRef<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        align={align}
        className={cn("el-menu", className)}
        {...props}
      />
    </M.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof M.Item>) {
  return <M.Item className={cn("el-menu__item", className)} {...props} />;
}

export function DropdownMenuRadioGroup(props: React.ComponentPropsWithoutRef<typeof M.RadioGroup>) {
  return <M.RadioGroup {...props} />;
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn("el-menu__item", "el-menu__item--check", className)} {...props}>
      <span className="el-menu__check" aria-hidden="true">
        <M.ItemIndicator>
          <Check size={14} />
        </M.ItemIndicator>
      </span>
      {children}
    </M.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof M.Label>) {
  return <M.Label className={cn("label", "el-menu__label", className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof M.Separator>) {
  return <M.Separator className={cn("el-menu__sep", className)} {...props} />;
}
