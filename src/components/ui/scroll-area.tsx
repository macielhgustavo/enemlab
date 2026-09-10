"use client";
import * as React from "react";
import { ScrollArea as SA } from "radix-ui";
import { cn } from "@/lib/cn";

export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SA.Root>) {
  return (
    <SA.Root className={cn("el-scroll", className)} {...props}>
      <SA.Viewport className="el-scroll__viewport">{children}</SA.Viewport>
      <SA.Scrollbar orientation="vertical" className="el-scroll__bar">
        <SA.Thumb className="el-scroll__thumb" />
      </SA.Scrollbar>
      <SA.Corner />
    </SA.Root>
  );
}
