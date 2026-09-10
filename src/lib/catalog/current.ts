// Índice do catálogo do estado atual.
//
// A v8.5 entrega a plataforma e providers de referência. Este arquivo
// constrói o índice a partir do que já existe — ENEM, ITA, IME, FUVEST, AFA e EPCAR — para
// que o Data Quality e o seletor de prova já leiam do índice, e não da
// forma antiga.
//
// Quando os importadores das próximas waves gerarem `catalog.generated.json`,
// esta função passa a lê-lo. A interface não muda junto: é esse o ponto de
// ter um índice.

import { CatalogIndex, type CatalogEntry } from "./index";
import { withNativeCoverage } from "../native/catalog";
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
} from "../providers";
import { listSources } from "../sources";
import type { ExamFamilyId } from "../sources/types";
import { fabValidationLevel } from "../providers/fab/evidence";
import afaRaw from "../providers/afa/answer-keys.generated.json";
import epcarRaw from "../providers/epcar/answer-keys.generated.json";
import type { FabAnswerKeyRaw } from "../providers/fab";
import { referenceMeasure } from "../providers/vestibular-reference";
import type { ValidationLevel } from "../sources/ingestion";

/**
 * Nível de validação das provas que já estavam no app.
 *
 * `reviewed`, não `verified`: as duas foram conferidas contra a fonte
 * durante as versões anteriores — o gabarito do ITA foi comparado
 * manualmente com o PDF em duas edições —, mas não passaram pelo pipeline
 * determinístico que a v8.5.0 acabou de criar. Chamá-las de `verified`
 * seria dar ao pipeline um crédito que ele ainda não recebeu.
 */
const NIVEL_HERDADO = "reviewed" as const;

function familiaDe(providerId: string): ExamFamilyId {
  return listSources().find((s) => s.providerId === providerId)?.family ?? "general";
}

/**
 * Quantas questões uma edição tem, quando isso é sabido sem carregá-la.
 *
 * Providers em modo referência guardam o gabarito, e o gabarito diz o
 * tamanho da prova. Fonte estruturada só sabe depois de buscar — e aí a
 * resposta honesta é `null`.
 */
function medirEdicao(
  providerId: string,
  ano: number,
): { total: number; subjects: Record<string, number>; validationLevel?: ValidationLevel } | null {
  if (providerId === ITA_PROVIDER_ID) {
    const k = itaAnswerKey(ano);
    if (!k) return null;
    return {
      total: k.total,
      subjects: Object.fromEntries(
        Object.entries(k.subjects ?? {}).map(([nome, faixa]) => [
          nome,
          Array.isArray(faixa) ? faixa.length : Number(faixa) || 0,
        ]),
      ),
    };
  }

  if (providerId === IME_PROVIDER_ID) {
    const edicao = imeEditionOfYear(ano);
    const k = edicao ? imeAnswerKey(edicao) : null;
    if (!k) return null;
    return {
      total: k.total,
      subjects: Object.fromEntries(
        Object.entries(k.subjects).map(([nome, nums]) => [nome, nums.length]),
      ),
    };
  }

  if (providerId === FUVEST_PROVIDER_ID) {
    const k = fuvestAnswerKey(ano);
    if (!k) return null;
    // A 1ª fase é de conhecimentos gerais: o gabarito não separa por
    // matéria, e inventar uma divisão seria classificação falsa.
    return { total: k.total, subjects: { "conhecimentos-gerais": k.total } };
  }

  if (providerId === AFA_PROVIDER_ID) {
    const k = afaAnswerKey(ano);
    if (!k) return null;
    return {
      total: k.total,
      subjects: Object.fromEntries(
        Object.entries(k.subjects).map(([nome, numeros]) => [nome, numeros.length]),
      ),
    };
  }

  if (providerId === EPCAR_PROVIDER_ID) {
    const k = epcarAnswerKey(ano);
    if (!k) return null;
    return {
      total: k.total,
      subjects: Object.fromEntries(
        Object.entries(k.subjects).map(([nome, numeros]) => [nome, numeros.length]),
      ),
    };
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

  return null;
}

/** Monta o índice a partir dos providers registrados. */
export function buildCurrentCatalog(): CatalogIndex {
  const entradas: CatalogEntry[] = [];

  for (const p of listProviders()) {
    const fonte = listSources().find((s) => s.providerId === p.id);
    if (!fonte) continue;

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

    // Só entram as fases cujas questões o app realmente tem. Fase publicada
    // não é fase ingerida: o ITA e o IME publicam discursiva, e listá-la com
    // a contagem da objetiva inflaria o catálogo com questões inexistentes.
    const soPrimeiraFase =
      p.id === ITA_PROVIDER_ID ||
      p.id === IME_PROVIDER_ID ||
      p.id === FUVEST_PROVIDER_ID ||
      p.id === AFA_PROVIDER_ID ||
      p.id === EPCAR_PROVIDER_ID ||
      p.id === UNICAMP_PROVIDER_ID ||
      p.id === UEL_PROVIDER_ID;
    const fasesIngeridas = p.metadata.phases.filter((f) =>
      soPrimeiraFase ? f === "first" : true,
    );

    for (const ano of p.metadata.years) {
      // Contagem por edição, onde o gabarito já ingerido a conhece. Quem não
      // sabe informa `null` — nunca zero.
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
          // O ITA sabe o tamanho da prova pelo gabarito já ingerido; o ENEM
          // só saberia carregando a edição. `null` diz isso — zero diria
          // que a prova não tem questão.
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

  const familias = Object.fromEntries(
    listProviders().map((p) => [p.id, familiaDe(p.id)]),
  );

  return new CatalogIndex(entradas.map((entry) => withNativeCoverage(entry)), familias);
}
