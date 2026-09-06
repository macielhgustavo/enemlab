"use client";
import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/cn";

/** Abas com navegação por setas e roving tabindex, vindas do primitive. */
export const Tabs = T.Root;

export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof T.List>) {
  return <T.List className={cn("el-tabs", className)} {...props} />;
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof T.Trigger>) {
  return <T.Trigger className={cn("el-tabs__trigger", className)} {...props} />;
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof T.Content>) {
  return <T.Content className={cn("el-tabs__content", className)} {...props} />;
}
