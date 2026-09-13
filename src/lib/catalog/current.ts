// Índice do catálogo do estado atual.
//
// O catálogo é montado a partir dos providers e fontes já validados. Fases
// discursivas/somatórias que não pertencem ao runner objetivo não são
// publicadas aqui.

import { CatalogIndex, type CatalogEntry } from "./index";
import {
  listProviders,
  itaAnswerKey,
  ITA_PROVIDER_ID,
  imeAnswerKey,
  imeEditionOfYear,
  IME_PROVIDER_ID,
  fuvestAnswerKey,
  FUVEST_PROVIDER_ID,
  afaAnswerKey,
  AFA_PROVIDER_ID,
  epcarAnswerKey,
  EPCAR_PROVIDER_ID,
  espcexAnswerKey,
  ESPCEX_PROVIDER_ID,
  esaAnswerKey,
  ESA_PROVIDER_ID,
  eearAnswerKey,
  eearEditions,
  EEAR_PROVIDER_ID,
  unicampAnswerKey,
  UNICAMP_PROVIDER_ID,
  uelAnswerKey,
  UEL_PROVIDER_ID,
  pucSpAnswerKey,
  PUC_SP_PROVIDER_ID,
  udescAnswerKeys,
  udescEditions,
  UDESC_PROVIDER_ID,
  acafeAnswerKey,
  acafeEditions,
  ACAFE_PROVIDER_ID,
  fatecAnswerKey,
  fatecEditions,
  FATEC_PROVIDER_ID,
  unespAnswerKey,
  UNESP_PROVIDER_ID,
  unioesteAnswerKeys,
  UNIOESTE_PROVIDER_ID,
} from "../providers";
import { listSources } from "../sources";
import type { ExamFamilyId } from "../sources/types";
import { fabValidationLevel } from "../providers/fab/evidence";
import afaRaw from "../providers/afa/answer-keys.generated.json";
import epcarRaw from "../providers/epcar/answer-keys.generated.json";
import type { FabAnswerKeyRaw } from "../providers/fab";
import {
  referenceMeasure,
  type ReferenceAnswerKey,
} from "../providers/vestibular-reference";
import type { ValidationLevel } from "../sources/ingestion";

const NIVEL_HERDADO = "reviewed" as const;

function familiaDe(providerId: string): ExamFamilyId {
  return listSources().find((source) => source.providerId === providerId)?.family ?? "general";
}

function medirEdicao(
  providerId: string,
  ano: number,
): { total: number; subjects: Record<string, number>; validationLevel?: ValidationLevel } | null {
  if (providerId === ITA_PROVIDER_ID) {
    const key = itaAnswerKey(ano);
    if (!key) return null;
    return {
      total: key.total,
      subjects: Object.fromEntries(
        Object.entries(key.subjects ?? {}).map(([nome, faixa]) => [
          nome,
          Array.isArray(faixa) ? faixa.length : Number(faixa) || 0,
        ]),
      ),
    };
  }

  if (providerId === IME_PROVIDER_ID) {
    const edicao = imeEditionOfYear(ano);
    const key = edicao ? imeAnswerKey(edicao) : null;
    if (!key) return null;
    return {
      total: key.total,
      subjects: Object.fromEntries(
        Object.entries(key.subjects).map(([nome, numeros]) => [nome, numeros.length]),
      ),
    };
  }

  if (providerId === FUVEST_PROVIDER_ID) {
    const key = fuvestAnswerKey(ano);
    return key ? { total: key.total, subjects: { "conhecimentos-gerais": key.total } } : null;
  }

  if (providerId === AFA_PROVIDER_ID) {
    const key = afaAnswerKey(ano);
    return key
      ? {
          total: key.total,
          subjects: Object.fromEntries(
            Object.entries(key.subjects).map(([nome, numeros]) => [nome, numeros.length]),
          ),
        }
      : null;
  }

  if (providerId === EPCAR_PROVIDER_ID) {
    const key = epcarAnswerKey(ano);
    return key
      ? {
          total: key.total,
          subjects: Object.fromEntries(
            Object.entries(key.subjects).map(([nome, numeros]) => [nome, numeros.length]),
          ),
        }
      : null;
  }

  if (providerId === ESA_PROVIDER_ID) {
    const key = esaAnswerKey(ano);
    return key
      ? {
          total: key.total,
          subjects: Object.fromEntries(
            Object.entries(key.subjects).map(([nome, faixa]) => [
              nome,
              faixa[1] - faixa[0] + 1,
            ]),
          ),
        }
      : null;
  }

  if (providerId === UNICAMP_PROVIDER_ID) {
    const key = unicampAnswerKey(ano);
    return key ? referenceMeasure(key) : null;
  }
  if (providerId === UEL_PROVIDER_ID) {
    const key = uelAnswerKey(ano);
    return key ? referenceMeasure(key) : null;
  }
  if (providerId === PUC_SP_PROVIDER_ID) {
    const key = pucSpAnswerKey(ano);
    return key ? referenceMeasure(key) : null;
  }
  if (providerId === UNESP_PROVIDER_ID) {
    const key = unespAnswerKey(ano);
    return key ? referenceMeasure(key) : null;
  }

  return null;
}

function pushReferenceEntry(
  entradas: CatalogEntry[],
  providerId: string,
  fonte: ReturnType<typeof listSources>[number],
  key: ReferenceAnswerKey,
): void {
  const medida = referenceMeasure(key);
  entradas.push({
    providerId,
    editionId: key.edition,
    year: key.year,
    phase: key.phase,
    questionCount: medida.total,
    subjects: medida.subjects,
    validation: medida.validationLevel,
    sourceId: fonte.id,
    statementAvailable: false,
    importerVersion: fonte.parserVersion,
  });
}

/** Monta o índice a partir dos providers registrados. */
export function buildCurrentCatalog(): CatalogIndex {
  const entradas: CatalogEntry[] = [];

  for (const provider of listProviders()) {
    const fonte = listSources().find((source) => source.providerId === provider.id);
    if (!fonte) continue;

    // EsPCEx é uma edição anual com dois dias objetivos reais. Preservar essa
    // estrutura evita perder a expansão histórica adicionada ao main.
    if (provider.id === ESPCEX_PROVIDER_ID) {
      for (const ano of provider.metadata.years) {
        const key = espcexAnswerKey(ano);
        if (!key) continue;
        for (const phase of ["day1", "day2"] as const) {
          const day = key.days[phase];
          entradas.push({
            providerId: provider.id,
            editionId: `${ano}-${phase}`,
            year: ano,
            phase,
            questionCount: day.total,
            subjects: Object.fromEntries(
              Object.entries(day.subjects).map(([name, numbers]) => [name, numbers.length]),
            ),
            validation: NIVEL_HERDADO,
            sourceId: fonte.id,
            statementAvailable: false,
            importerVersion: fonte.parserVersion,
          });
        }
      }
      continue;
    }

    // EEAR/FATEC têm edições nomeadas que não podem ser reduzidas ao ano.
    if (provider.id === EEAR_PROVIDER_ID || provider.id === FATEC_PROVIDER_ID) {
      const editions = provider.id === EEAR_PROVIDER_ID ? eearEditions() : fatecEditions();
      for (const edition of editions) {
        const key =
          provider.id === EEAR_PROVIDER_ID
            ? eearAnswerKey(edition.id)
            : fatecAnswerKey(edition.id);
        if (key) pushReferenceEntry(entradas, provider.id, fonte, key);
      }
      continue;
    }

    // UNIOESTE preserva manhã/tarde como sessões reais da mesma edição anual.
    if (provider.id === UNIOESTE_PROVIDER_ID) {
      for (const ano of provider.metadata.years) {
        for (const key of unioesteAnswerKeys(ano)) {
          pushReferenceEntry(entradas, provider.id, fonte, key);
        }
      }
      continue;
    }

    if (provider.id === UDESC_PROVIDER_ID || provider.id === ACAFE_PROVIDER_ID) {
      const editions =
        provider.id === UDESC_PROVIDER_ID ? udescEditions() : acafeEditions();
      for (const edition of editions) {
        const keys =
          provider.id === UDESC_PROVIDER_ID
            ? udescAnswerKeys(edition.id)
            : [acafeAnswerKey(edition.id)].filter((key) => key !== null);
        for (const key of keys) pushReferenceEntry(entradas, provider.id, fonte, key);
      }
      continue;
    }

    // Só entram fases para as quais o runner realmente tem questões de
    // alternativa única. Fase publicada não é automaticamente fase ingerida.
    const soPrimeiraFase =
      provider.id === ITA_PROVIDER_ID ||
      provider.id === IME_PROVIDER_ID ||
      provider.id === FUVEST_PROVIDER_ID ||
      provider.id === AFA_PROVIDER_ID ||
      provider.id === EPCAR_PROVIDER_ID ||
      provider.id === UNICAMP_PROVIDER_ID ||
      provider.id === UEL_PROVIDER_ID ||
      provider.id === UNESP_PROVIDER_ID;
    const fasesIngeridas = provider.metadata.phases.filter((phase) =>
      soPrimeiraFase ? phase === "first" : true,
    );

    for (const ano of provider.metadata.years) {
      const medida = medirEdicao(provider.id, ano);
      const contagem = medida?.total ?? null;
      const materias = medida?.subjects ?? {};
      const fabDataset =
        provider.id === AFA_PROVIDER_ID
          ? afaRaw
          : provider.id === EPCAR_PROVIDER_ID
            ? epcarRaw
            : null;
      const fabRaw = fabDataset
        ? (fabDataset as unknown as Record<string, FabAnswerKeyRaw>)[String(ano)]
        : null;

      for (const fase of fasesIngeridas) {
        entradas.push({
          providerId: provider.id,
          editionId: String(ano),
          year: ano,
          phase: fase,
          questionCount: contagem,
          subjects: materias,
          validation:
            medida?.validationLevel ??
            (fabRaw ? fabValidationLevel(provider.id, fabRaw) : NIVEL_HERDADO),
          sourceId: fonte.id,
          statementAvailable: fonte.statementMode !== "reference-only",
          importerVersion: fonte.parserVersion,
        });
      }
    }
  }

  const familias = Object.fromEntries(
    listProviders().map((provider) => [provider.id, familiaDe(provider.id)]),
  );
  return new CatalogIndex(entradas, familias);
}
