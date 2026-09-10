import * as React from "react";
import { Separator as S } from "radix-ui";
import { cn } from "@/lib/cn";

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentPropsWithoutRef<typeof S.Root>) {
  return (
    <S.Root
      orientation={orientation}
      className={cn("el-separator", `el-separator--${orientation}`, className)}
      {...props}
    />
  );
}
