import { afterEach, describe, expect, it } from "vitest";
import { getAIProvider } from "./index";

const ORIGINAL = {
  provider: process.env.ENEMLAB_AI_PROVIDER,
  openrouterKey: process.env.OPENROUTER_API_KEY,
  genericKey: process.env.ENEMLAB_AI_API_KEY,
  model: process.env.ENEMLAB_AI_MODEL,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("ENEMLAB_AI_PROVIDER", ORIGINAL.provider);
  restore("OPENROUTER_API_KEY", ORIGINAL.openrouterKey);
  restore("ENEMLAB_AI_API_KEY", ORIGINAL.genericKey);
  restore("ENEMLAB_AI_MODEL", ORIGINAL.model);
});

describe("getAIProvider", () => {
  it("cria provider OpenRouter quando chave e modelo estão configurados", () => {
    process.env.ENEMLAB_AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "server-secret";
    process.env.ENEMLAB_AI_MODEL = "provider/model";

    expect(getAIProvider().id).toBe("openrouter");
  });

  it("falha antes da rede quando OpenRouter está sem configuração", () => {
    process.env.ENEMLAB_AI_PROVIDER = "openrouter";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ENEMLAB_AI_API_KEY;
    delete process.env.ENEMLAB_AI_MODEL;

    expect(() => getAIProvider()).toThrow(/OPENROUTER_API_KEY/);
  });
});
