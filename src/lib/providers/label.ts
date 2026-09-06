// Rótulo curto da prova, para a UI parar de escrever "ENEM" fixo.
import { getProvider, resolveProviderId } from "./registry";

export function examLabel(providerId?: string | null): string {
  try {
    return getProvider(providerId).metadata.shortLabel;
  } catch {
    // Provider desconhecido (dado de versão futura): não mentir dizendo ENEM.
    return resolveProviderId(providerId).toUpperCase();
  }
}
