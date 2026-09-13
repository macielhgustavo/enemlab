// Índice do catálogo do estado atual.
import { CatalogIndex, type CatalogEntry } from "./index";
import {
  listProviders,
  itaAnswerKey, ITA_PROVIDER_ID,
  imeAnswerKey, imeEditionOfYear, IME_PROVIDER_ID,
  fuvestAnswerKey, FUVEST_PROVIDER_ID,
  afaAnswerKey, AFA_PROVIDER_ID,
  epcarAnswerKey, EPCAR_PROVIDER_ID,
  espcexAnswerKey, ESPCEX_PROVIDER_ID,
  esaAnswerKey, ESA_PROVIDER_ID,
  eearAnswerKey, eearEditions, EEAR_PROVIDER_ID,
  unicampAnswerKey, UNICAMP_PROVIDER_ID,
  uelAnswerKey, UEL_PROVIDER_ID,
  pucSpAnswerKey, PUC_SP_PROVIDER_ID,
  udescAnswerKeys, udescEditions, UDESC_PROVIDER_ID,
  acafeAnswerKey, acafeEditions, ACAFE_PROVIDER_ID,
  fatecAnswerKey, fatecEditions, FATEC_PROVIDER_ID,
  unespAnswerKey, UNESP_PROVIDER_ID,
  unioesteAnswerKeys, UNIOESTE_PROVIDER_ID,
} from "../providers";
import { listSources } from "../sources";
import type { ExamFamilyId } from "../sources/types";
import { fabValidationLevel } from "../providers/fab/evidence";
import afaRaw from "../providers/afa/answer-keys.generated.json";
import epcarRaw from "../providers/epcar/answer-keys.generated.json";
import type { FabAnswerKeyRaw } from "../providers/fab";
import { referenceMeasure } from "../providers/vestibular-reference";
import type { ValidationLevel } from "../sources/ingestion";

const NIVEL_HERDADO = "reviewed" as const;

function familiaDe(providerId: string): ExamFamilyId {
  return listSources().find((s) => s.providerId === providerId)?.family ?? "general";
}

function medirEdicao(
  providerId: string,
  ano: number,
): { total: number; subjects: Record<string, number>; validationLevel?: ValidationLevel } | null {
  if (providerId === ITA_PROVIDER_ID) {
    const k = itaAnswerKey(ano);
    if (!k) return null;
    return {
      total: k.total,
      subjects: Object.fromEntries(Object.entries(k.subjects ?? {}).map(([nome, faixa]) => [
        nome,
        Array.isArray(faixa) ? faixa.length : Number(faixa) || 0,
      ])),
    };
  }

  if (providerId === IME_PROVIDER_ID) {
    const edicao = imeEditionOfYear(ano);
    const k = edicao ? imeAnswerKey(edicao) : null;
    if (!k) return null;
    return { total: k.total, subjects: Object.fromEntries(Object.entries(k.subjects).map(([nome, nums]) => [nome, nums.length])) };
  }

  if (providerId === FUVEST_PROVIDER_ID) {
    const k = fuvestAnswerKey(ano);
    return k ? { total: k.total, subjects: { "conhecimentos-gerais": k.total } } : null;
  }

  if (providerId === AFA_PROVIDER_ID) {
    const k = afaAnswerKey(ano);
    return k ? { total: k.total, subjects: Object.fromEntries(Object.entries(k.subjects).map(([nome, numeros]) => [nome, numeros.length])) } : null;
  }

  if (providerId === EPCAR_PROVIDER_ID) {
    const k = epcarAnswerKey(ano);
    return k ? { total: k.total, subjects: Object.fromEntries(Object.entries(k.subjects).map(([nome, numeros]) => [nome, numeros.length])) } : null;
  }

  if (providerId === ESA_PROVIDER_ID) {
    const k = esaAnswerKey(ano);
    return k ? { total: k.total, subjects: Object.fromEntries(Object.entries(k.subjects).map(([name, range]) => [name, range[1] - range[0] + 1])) } : null;
  }

  if (providerId === UNICAMP_PROVIDER_ID) {
    const k = unicampAnswerKey(ano);
    return k ? referenceMeasure(k) : null;
  }
  if (providerId === UEL_PROVIDER_ID) {
    const k = uelAnswerKey(ano);
    return k ? referenceMeasure(k) : null;
  }
  if (providerId === PUC_SP_PROVIDER_ID) {
    const k = pucSpAnswerKey(ano);
    return k ? referenceMeasure(k) : null;
  }
  if (providerId === UNESP_PROVIDER_ID) {
    const k = unespAnswerKey(ano);
    return k ? referenceMeasure(k) : null;
  }
  return null;
}

function pushReferenceEntry(
  entradas: CatalogEntry[],
  providerId: string,
  fonte: ReturnType<typeof listSources>[number],
  key: NonNullable<ReturnType<typeof eearAnswerKey>>,
) {
  const measure = referenceMeasure(key);
  entradas.push({
    providerId,
    editionId: key.edition,
    year: key.year,
    phase: key.phase,
    questionCount: measure.total,
    subjects: measure.subjects,
    validation: measure.validationLevel,
    sourceId: fonte.id,
    statementAvailable: false,
    importerVersion: fonte.parserVersion,
  });
}

export function buildCurrentCatalog(): CatalogIndex {
  const entradas: CatalogEntry[] = [];

  for (const p of listProviders()) {
    const fonte = listSources().find((s) => s.providerId === p.id);
    if (!fonte) continue;

    if (p.id === ESPCEX_PROVIDER_ID) {
      for (const ano of p.metadata.years) {
        const key = espcexAnswerKey(ano);
        if (!key) continue;
        for (const phase of ["day1", "day2"] as const) {
          const day = key.days[phase];
          entradas.push({
            providerId: p.id,
            editionId: `${ano}-${phase}`,
            year: ano,
            phase,
            questionCount: day.total,
            subjects: Object.fromEntries(Object.entries(day.subjects).map(([name, numbers]) => [name, numbers.length])),
            validation: NIVEL_HERDADO,
            sourceId: fonte.id,
            statementAvailable: false,
            importerVersion: fonte.parserVersion,
          });
        }
      }
      continue;
    }

    if (p.id === EEAR_PROVIDER_ID || p.id === FATEC_PROVIDER_ID) {
      const editions = p.id === EEAR_PROVIDER_ID ? eearEditions() : fatecEditions();
      for (const edition of editions) {
        const key = p.id === EEAR_PROVIDER_ID ? eearAnswerKey(edition.id) : fatecAnswerKey(edition.id);
        if (key) pushReferenceEntry(entradas, p.id, fonte, key);
      }
      continue;
    }

    if (p.id === UNIOESTE_PROVIDER_ID) {
      for (const ano of p.metadata.years) {
        for (const key of unioesteAnswerKeys(ano)) pushReferenceEntry(entradas, p.id, fonte, key);
      }
      continue;
    }

    if (p.id === UDESC_PROVIDER_ID || p.id === ACAFE_PROVIDER_ID) {
      const editions = p.id === UDESC_PROVIDER_ID ? udescEditions() : acafeEditions();
      for (const edition of editions) {
        const keys = p.id === UDESC_PROVIDER_ID
          ? udescAnswerKeys(edition.id)
          : [acafeAnswerKey(edition.id)].filter((key) => key !== null);
        for (const key of keys) {
          const measure = referenceMeasure(key);
          entradas.push({
            providerId: p.id,
            editionId: key.edition,
            year: key.year,
            phase: key.phase,
            questionCount: measure.total,
            subjects: measure.subjects,
            validation: measure.validationLevel,
            sourceId: fonte.id,
            statementAvailable: false,
            importerVersion: fonte.parserVersion,
          });
        }
      }
      continue;
    }

    const soPrimeiraFase =
      p.id === ITA_PROVIDER_ID ||
      p.id === IME_PROVIDER_ID ||
      p.id === FUVEST_PROVIDER_ID ||
      p.id === AFA_PROVIDER_ID ||
      p.id === EPCAR_PROVIDER_ID ||
      p.id === UNICAMP_PROVIDER_ID ||
      p.id === UEL_PROVIDER_ID ||
      p.id === UNESP_PROVIDER_ID;
    const fasesIngeridas = p.metadata.phases.filter((f) => soPrimeiraFase ? f === "first" : true);

    for (const ano of p.metadata.years) {
      const medida = medirEdicao(p.id, ano);
      const contagem = medida?.total ?? null;
      const materias = medida?.subjects ?? {};
      const fabDataset = p.id === AFA_PROVIDER_ID ? afaRaw : p.id === EPCAR_PROVIDER_ID ? epcarRaw : null;
      const fabRaw = fabDataset ? (fabDataset as unknown as Record<string, FabAnswerKeyRaw>)[String(ano)] : null;

      for (const fase of fasesIngeridas) {
        entradas.push({
          providerId: p.id,
          editionId: String(ano),
          year: ano,
          phase: fase,
          questionCount: contagem,
          subjects: materias,
          validation: medida?.validationLevel ?? (fabRaw ? fabValidationLevel(p.id, fabRaw) : NIVEL_HERDADO),
          sourceId: fonte.id,
          statementAvailable: fonte.statementMode !== "reference-only",
          importerVersion: fonte.parserVersion,
        });
      }
    }
  }

  const familias = Object.fromEntries(listProviders().map((p) => [p.id, familiaDe(p.id)]));
  return new CatalogIndex(entradas, familias);
}
