/**
 * Identidade pública do produto.
 *
 * Identificadores legados como "enem_lab_v7" permanecem estáveis por
 * compatibilidade de dados; a marca apresentada ao usuário é Studium.
 */
export const PRODUCT_BRAND = {
  name: "Studium",
  monogram: "S",
  description:
    "Plataforma pessoal adaptativa para estudar com provas oficiais e múltiplos vestibulares.",
} as const;

export function Brand() {
  return (
    <div className="brand">
      <span className="mark" aria-hidden="true">
        {PRODUCT_BRAND.monogram}
      </span>
      <span className="name">{PRODUCT_BRAND.name}</span>
    </div>
  );
}
