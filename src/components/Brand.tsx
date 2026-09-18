/** Identidade exibida. Chaves de persistência e IDs de prova permanecem estáveis. */
export const PRODUCT_BRAND = {
  name: "Studium Labs",
  monogram: "S",
  description: "Estudo orientado por evidências, para provas reais.",
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
