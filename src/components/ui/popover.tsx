"use client";
import * as React from "react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/cn";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({
  className,
  sideOffset = 8,
  align = "start",
  ...props
}: React.ComponentPropsWithoutRef<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        align={align}
        className={cn("el-popover", className)}
        {...props}
      />
    </P.Portal>
  );
}
