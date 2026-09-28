/** Marca pública da plataforma. Identificadores "enem_lab*" permanecem apenas por compatibilidade técnica. */
export const PRODUCT_BRAND = {
  name: "Studium",
  monogram: "S",
  description:
    "Plataforma pessoal de estudos para ENEM e vestibulares, com treino, revisão, redação e simulado baseados no histórico real.",
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
