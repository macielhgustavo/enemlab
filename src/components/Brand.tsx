/** Identidade atual. A próxima marca troca este contrato, não cada tela. */
export const PRODUCT_BRAND = {
  name: "ENEM Lab",
  monogram: "E",
  description: "Plataforma pessoal adaptativa para questões reais do ENEM.",
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
