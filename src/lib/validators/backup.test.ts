import { describe, expect, it } from "vitest";
import { parseBackup } from "./backup";

const backupLegado = {
  v: 6,
  schema: 6.6,
  theme: "dark",
  attempts: [{ id: "a_1", year: 2023, answers: { "2023-1": "A" } }],
  notes: {},
  srs: {},
  sessions: [],
  goals: { questions: 150, essays: 1, reviews: 60 },
};

describe("parseBackup", () => {
  it("rejeita arquivo que não é JSON", () => {
    const r = parseBackup("isto não é json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/i);
  });

  it("rejeita JSON que não é um backup", () => {
    const r = parseBackup(JSON.stringify({ foo: "bar" }));
    expect(r.ok).toBe(false);
  });

  it("aceita backup legado e o atribui ao ENEM", () => {
    const r = parseBackup(JSON.stringify(backupLegado));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.attempts).toBe(1);
      expect(r.providers).toEqual(["enem"]);
    }
  });

  it("nunca descarta campos desconhecidos do usuário", () => {
    const comExtras = {
      ...backupLegado,
      campoFuturo: { mantido: true },
      attempts: [{ ...backupLegado.attempts[0], anotacaoExtra: "preservar" }],
    };
    const r = parseBackup(JSON.stringify(comExtras));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const data = r.data as unknown as Record<string, unknown>;
      expect(data.campoFuturo).toEqual({ mantido: true });
      expect((r.data.attempts[0] as unknown as Record<string, unknown>).anotacaoExtra).toBe(
        "preservar",
      );
    }
  });

  it("reporta provas distintas presentes no arquivo", () => {
    const misto = {
      ...backupLegado,
      attempts: [
        { id: "a_1", year: 2023 },
        { id: "a_2", year: 2023, providerId: "outra-prova" },
      ],
    };
    const r = parseBackup(JSON.stringify(misto));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.providers.sort()).toEqual(["enem", "outra-prova"]);
  });

  it("rejeita tentativa sem id", () => {
    const r = parseBackup(JSON.stringify({ ...backupLegado, attempts: [{ year: 2023 }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/attempts/);
  });
});
