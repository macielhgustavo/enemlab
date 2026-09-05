"use client";
import { useStore } from "./store";

/** true quando o store terminou de reidratar do localStorage (evita mismatch SSR). */
export function useHydrated(): boolean {
  return useStore((s) => s.hydrated);
}
