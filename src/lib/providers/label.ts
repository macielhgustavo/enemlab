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

export function editionOptions(providerId?: string | null) {
  const metadata = getProvider(providerId).metadata;
  return metadata.editions ?? metadata.years.map((year) => ({
    id: String(year),
    label: `${metadata.shortLabel} ${year}`,
    year,
  }));
}

export function phaseLabel(phase?: string): string {
  if (phase === "morning") return "período matutino";
  if (phase === "afternoon") return "período vespertino";
  if (phase === "second") return "2ª fase";
  if (phase === "day1") return "dia 1";
  if (phase === "day2") return "dia 2";
  if (phase === "single") return "prova única";
  return "1ª fase";
}
