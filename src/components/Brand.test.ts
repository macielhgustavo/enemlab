import { describe, expect, it } from "vitest";
import { PRODUCT_BRAND } from "./Brand";

describe("PRODUCT_BRAND", () => {
  it("declara Studium como plataforma multi-prova", () => {
    expect(PRODUCT_BRAND.name).toBe("Studium");
    expect(PRODUCT_BRAND.monogram).toBe("S");
    expect(PRODUCT_BRAND.description).toMatch(/ENEM e vestibulares/i);
  });
});
