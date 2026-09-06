import { Badge } from "@/components/ui/badge";
import { examLabel } from "@/lib/providers/label";

/**
 * Sigla da banca de uma linha ou cartão.
 *
 * Existe porque o Histórico mistura provas de propósito: sem a sigla, duas
 * linhas idênticas de anos diferentes viram a mesma coisa aos olhos.
 */
export function ProviderBadge({ providerId }: { providerId?: string | null }) {
  return (
    <Badge variant="outline" title={`Prova: ${examLabel(providerId)}`}>
      {examLabel(providerId)}
    </Badge>
  );
}
