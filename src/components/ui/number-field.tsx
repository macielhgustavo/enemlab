"use client";

// ReUI NumberField composition, adapted to native number inputs (MIT).
// Native stepping preserves browser keyboard behavior without another UI runtime.
import { useRef, type ComponentProps } from "react";
import { Minus, Plus } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

const fieldVariants = cva("number-field", {
  variants: { size: { default: "number-field--default", compact: "number-field--compact" } },
  defaultVariants: { size: "default" },
});

type NumberFieldProps = Omit<
  ComponentProps<"input">,
  "type" | "size" | "onChange" | "value"
> & {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  size?: "default" | "compact";
};

export function NumberField({
  value,
  onValueChange,
  label,
  className,
  size,
  disabled,
  min,
  max,
  ...props
}: NumberFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const step = (direction: "up" | "down") => {
    if (!input.current) return;
    if (direction === "up") input.current.stepUp();
    else input.current.stepDown();
    onValueChange(input.current.value);
  };
  return (
    <div data-slot="number-field" className={cn(fieldVariants({ size }), className)}>
      <button
        type="button"
        aria-label={`Diminuir ${label}`}
        disabled={
          disabled || (value !== "" && min !== undefined && Number(value) <= Number(min))
        }
        onClick={() => step("down")}
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <input
        {...props}
        ref={input}
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        disabled={disabled}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={`Aumentar ${label}`}
        disabled={
          disabled || (value !== "" && max !== undefined && Number(value) >= Number(max))
        }
        onClick={() => step("up")}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
