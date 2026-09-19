"use client";

// Adapted from Origin UI / coss ui InputGroup (MIT). See THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const addonVariants = cva("input-group__addon", {
  variants: {
    align: {
      "inline-start": "input-group__addon--start",
      "inline-end": "input-group__addon--end",
    },
  },
  defaultVariants: { align: "inline-start" },
});

export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="input-group"
      className={cn("input-group", className)}
      {...props}
    />
  );
}

export function InputGroupAddon({
  className,
  align,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof addonVariants>) {
  return (
    <div
      data-slot="input-group-addon"
      className={cn(addonVariants({ align }), className)}
      onMouseDown={(event) => {
        const target = event.target as Element;
        if (target.closest("button, a, input, select, textarea, [role='button']")) return;
        event.preventDefault();
        event.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
      {...props}
    />
  );
}

export function InputGroupInput({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn("input-group__input", className)} {...props} />;
}
