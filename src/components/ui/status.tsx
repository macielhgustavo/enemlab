// Adapted from Kibo UI Status (MIT). See THIRD_PARTY_NOTICES.md.
import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const statusVariants = cva("study-status", {
  variants: {
    status: {
      complete: "study-status--complete",
      active: "study-status--active",
      waiting: "study-status--waiting",
    },
  },
  defaultVariants: { status: "waiting" },
});

export function Status({
  className,
  status,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof statusVariants>) {
  return <span className={cn(statusVariants({ status }), className)} {...props} />;
}

export function StatusIndicator({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span aria-hidden="true" className={cn("study-status__indicator", className)} {...props} />
  );
}

export function StatusLabel(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} />;
}
