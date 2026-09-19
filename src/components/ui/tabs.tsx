"use client";
import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/cn";
import { cva, type VariantProps } from "class-variance-authority";

/** Abas com navegação por setas e roving tabindex, vindas do primitive. */
export const Tabs = T.Root;

const tabsListVariants = cva("el-tabs", {
  variants: {
    variant: {
      segmented: "",
      line: "el-tabs--line",
    },
  },
  defaultVariants: { variant: "segmented" },
});

export function TabsList({
  className,
  variant,
  ...props
}: React.ComponentPropsWithoutRef<typeof T.List> & VariantProps<typeof tabsListVariants>) {
  return <T.List className={cn(tabsListVariants({ variant }), className)} {...props} />;
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
