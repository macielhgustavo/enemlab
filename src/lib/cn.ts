import { clsx, type ClassValue } from "clsx";

/**
 * Junta classes condicionais.
 *
 * Sem `tailwind-merge`: este projeto não estiliza por utilitário do Tailwind,
 * então não há conflito de utilitário para resolver. Uma classe por papel,
 * decidida no componente.
 */
export function cn(...parts: ClassValue[]): string {
  return clsx(parts);
}
