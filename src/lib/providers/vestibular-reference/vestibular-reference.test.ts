import { describe, expect, it } from "vitest";
import { questionKey } from "@/lib/domain/classify";
import { toLegacyQuestion } from "@/lib/providers/legacy";
import { buildCurrentCatalog } from "@/lib/catalog/current";
import { variantsForReference, variantsToIngest } from "@/lib/catalog/variant";
import {
  getProvider,
  listProviders,
  sameProvider,
  unicampAnswerKey,
  unicampFirstPhaseQuestions,
  unicampQuestionKey,
  unicampVariants,
  unicampYears,
  uelAnswerKey,
  uelFirstPhaseQuestions,
  uelQuestionKey,
  uelVariants,
  uelYears,
  pucSpAnswerKey,
  pucSpQuestionKey,
  pucSpQuestions,
  pucSpYears,
} from "@/lib/providers";
import {
  normalizeReferenceCatalog,
  type ReferenceAnswerKeyRaw,
} from "./index";

const PROVIDERS = ["unicamp", "uel", "puc-sp"] as const;

function minimalRaw(overrides: Partial<ReferenceAnswerKeyRaw> = {}): ReferenceAnswerKeyRaw {
  return {
    edition: "2099",
    year: 2099,
    label: "Fixture",
    phase: "single",
    total: 2,
    canonicalVariant: "unica",
    variantRelation: "unknown",
    revision: "final",
    answers: { "1": "A", "2": "B" },
    annulled: [],
    variants: [{ id: "unica", label: "Única", examUrl: "https://example.edu/prova.pdf" }],
    answerKeyUrl: "https://example.edu/gabarito.pdf",
    examUrl: "https://example.edu/prova.pdf",
    archivePage: "https://example.edu/archive",
    subjects: [{ id: "geral", label: "Geral", area: "geral", range: [1, 2] }],
    contentMode: "reference-only",
    rightsStatus: "official-reference",
    validationLevel: "reviewed",
    validationEvidence: ["fixture"],
    retrieval: {
      originalUrl: "https://example.edu/gabarito.pdf",
      effectiveSourceUrl: "https://example.edu/gabarito.pdf",
      sourceType: "pdf-reference",
      fetchedAt: "2026-09-08",
      sha256: "abc",
      bytes: 10,
      parserVersion: "fixture@1.0.0",
      revision: "final",
      final: true,
    },
    parserVersion: "fixture@1.0.0",
    ...overrides,
  };
}

describe("vestibulares em modo referência", () => {
  it("registra os três novos providers executáveis", () => {
    const ids = listProviders().map((provider) => provider.id);
    for (const id of PROVIDERS) expect(ids).toContain(id);
  });

  it("lista só edições revisadas e com contagem objetiva conhecida", () => {
    expect(unicampYears()).toEqual([2026, 2025, 2024]);
    expect(uelYears()).toEqual([2026]);
    expect(pucSpYears()).toEqual([2026, 2025, 2024]);

    const catalog = buildCurrentCatalog();
    expect(catalog.countQuestions({ providerIds: [...PROVIDERS] })).toEqual({
      known: 426,
      unknownEditions: 0,
    });
    expect(catalog.query({ providerId: "unicamp" })).toHaveLength(3);
    expect(catalog.query({ providerId: "uel" })).toHaveLength(1);
    expect(catalog.query({ providerId: "puc-sp" })).toHaveLength(3);
  });

  it("não reproduz enunciados e aponta para documento oficial", () => {
    for (const q of [
      ...unicampFirstPhaseQuestions(2025),
      ...uelFirstPhaseQuestions(2026),
      ...pucSpQuestions(2026),
    ]) {
      expect(q.statementAvailable).toBe(false);
      expect(q.official?.official).toBe(true);
      expect(q.official?.documentUrl).toMatch(/^https:\/\//);
      expect(q.alternatives.every((alternative) => alternative.text === null)).toBe(true);
    }
  });

  it("preserva anuladas e retificações finais", () => {
    expect(unicampAnswerKey(2025)?.annulled).toEqual([53]);
    expect(uelAnswerKey(2026)?.annulled).toEqual([41]);
    expect(pucSpAnswerKey(2024)?.annulled).toEqual([1]);
    expect(pucSpAnswerKey(2025)?.revision).toBe("rectified");
    expect(uelAnswerKey(2026)?.retrieval.final).toBe(true);
  });

  it("modela variantes como desconhecidas e ingere só a canônica", () => {
    const unicamp = unicampVariants(2025)!;
    const uel = uelVariants(2026)!;
    expect(unicamp.relation).toBe("unknown");
    expect(uel.relation).toBe("unknown");
    expect(variantsToIngest(unicamp).map((variant) => variant.id)).toEqual(["qz"]);
    expect(variantsForReference(unicamp).map((variant) => variant.id)).toEqual(["rw", "sx", "ty"]);
    expect(variantsToIngest(uel).map((variant) => variant.id)).toEqual(["tipo-1"]);
  });

  it("mantém PUC-SP separada das outras PUCs e de outros providers", () => {
    expect(getProvider("puc-sp").metadata.shortLabel).toBe("PUC-SP");
    expect(sameProvider("puc-sp", "puc-pr")).toBe(false);
    expect(sameProvider("puc-sp", "puc-rio")).toBe(false);
    expect(sameProvider("unicamp", "uel")).toBe(false);
  });

  it("gera chaves determinísticas com provider e idioma quando aplicável", () => {
    const unicamp = unicampFirstPhaseQuestions(2025)[0];
    const uel = uelFirstPhaseQuestions(2026)[0];
    const puc = pucSpQuestions(2026)[0];

    expect(unicampQuestionKey(unicamp)).toBe("unicamp-2025-first-1");
    expect(uelQuestionKey(uel)).toBe("uel-2026-first-ingles-1");
    expect(pucSpQuestionKey(puc)).toBe("puc-sp-2026-single-1");
    expect(questionKey(toLegacyQuestion(unicamp))).toBe("unicamp-2025-first-1");
    expect(questionKey(toLegacyQuestion(uel))).toBe("uel-2026-first-ingles-1");
  });

  it("falha fechado para preliminar, questão faltante e matéria duplicada", () => {
    expect(() =>
      normalizeReferenceCatalog("fixture", { "2099": minimalRaw({ revision: "preliminary" }) }),
    ).toThrow(/preliminar/);
    expect(() =>
      normalizeReferenceCatalog("fixture", {
        "2099": minimalRaw({ answers: { "1": "A" } }),
      }),
    ).toThrow(/faltante/);
    expect(() =>
      normalizeReferenceCatalog("fixture", {
        "2099": minimalRaw({
          subjects: [
            { id: "a", label: "A", area: "a", range: [1, 2] },
            { id: "b", label: "B", area: "b", range: [2, 2] },
          ],
        }),
      }),
    ).toThrow(/matérias/);
  });
});

