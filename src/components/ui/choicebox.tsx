"use client";

// Adapted from Kibo UI Choicebox (MIT). See THIRD_PARTY_NOTICES.md.
// Keeps its composable item/context API, using the existing Radix dependency.
import {
  createContext,
  useContext,
  useId,
  type ComponentProps,
  type HTMLAttributes,
} from "react";
import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/cn";

const ItemContext = createContext<{ value: string; id: string } | null>(null);

export function Choicebox({ className, ...props }: ComponentProps<typeof RadioGroup.Root>) {
  return <RadioGroup.Root className={cn("choicebox", className)} {...props} />;
}

export function ChoiceboxItem({
  value,
  id,
  children,
  className,
}: HTMLAttributes<HTMLLabelElement> & { value: string }) {
  const generatedId = useId();
  const itemId = id ?? generatedId;
  return (
    <ItemContext.Provider value={{ value, id: itemId }}>
      <label htmlFor={itemId} className={cn("choicebox__item", className)}>
        {children}
      </label>
    </ItemContext.Provider>
  );
}

export function ChoiceboxItemHeader(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={cn("choicebox__content", props.className)} />;
}

export function ChoiceboxItemTitle(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={cn("choicebox__title", props.className)} />;
}

export function ChoiceboxItemDescription(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={cn("choicebox__description", props.className)} />;
}

export function ChoiceboxIndicator() {
  const item = useContext(ItemContext);
  if (!item) throw new Error("ChoiceboxIndicator requires ChoiceboxItem");
  return (
    <RadioGroup.Item value={item.value} id={item.id} className="choicebox__radio">
      <RadioGroup.Indicator className="choicebox__dot" />
    </RadioGroup.Item>
  );
}
