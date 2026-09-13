/** Identidade visível do produto. Nomes internos podem migrar sem quebrar storage. */
export const PRODUCT_BRAND = {
  name: "Studium Labs",
  monogram: "S",
  description: "Plataforma pessoal de preparação para vestibulares e provas de alta exigência.",
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
