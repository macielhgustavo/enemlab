import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_ID,
  filterByProvider,
  getProvider,
  groupByProvider,
  hasProvider,
  listProviders,
  resolveProviderId,
  sameProvider,
} from "./index";

describe("compatibilidade com dados legados", () => {
  it("trata registro sem providerId como ENEM", () => {
    expect(resolveProviderId(undefined)).toBe("enem");
    expect(resolveProviderId(null)).toBe("enem");
    expect(resolveProviderId("")).toBe("enem");
    expect(resolveProviderId("   ")).toBe("enem");
    expect(DEFAULT_PROVIDER_ID).toBe("enem");
  });

  it("preserva o provider quando ele existe", () => {
    expect(resolveProviderId("outra-prova")).toBe("outra-prova");
  });

  it("considera legado e ENEM explícito a mesma prova", () => {
    expect(sameProvider(undefined, "enem")).toBe(true);
    expect(sameProvider(undefined, "outra")).toBe(false);
  });
});

describe("isolamento entre provas", () => {
  const registros = [
    { id: "antigo", providerId: undefined },
    { id: "enem-novo", providerId: "enem" },
    { id: "outra", providerId: "outra-prova" },
  ];

  it("não mistura estatísticas de provas diferentes", () => {
    const doEnem = filterByProvider(registros, "enem");
    expect(doEnem.map((r) => r.id)).toEqual(["antigo", "enem-novo"]);
    expect(filterByProvider(registros, "outra-prova").map((r) => r.id)).toEqual(["outra"]);
  });

  it("agrupa por prova normalizando os legados", () => {
    const grupos = groupByProvider(registros);
    expect(Object.keys(grupos).sort()).toEqual(["enem", "outra-prova"]);
    expect(grupos.enem).toHaveLength(2);
  });
});

describe("registry", () => {
  it("tem o ENEM registrado e funcional", () => {
    expect(hasProvider("enem")).toBe(true);
    const p = getProvider("enem");
    expect(p.id).toBe("enem");
    expect(p.metadata.shortLabel).toBe("ENEM");
    expect(p.metadata.hasEssay).toBe(true);
    expect(p.metadata.years.length).toBeGreaterThan(0);
  });

  it("resolve provider ausente como ENEM", () => {
    expect(getProvider(undefined).id).toBe("enem");
  });

  it("falha alto para provider desconhecido", () => {
    expect(() => getProvider("fuvest")).toThrow(/não registrado/i);
  });

  it("não traz nenhuma prova externa ainda", () => {
    expect(listProviders().map((p) => p.id)).toEqual(["enem"]);
  });
});
