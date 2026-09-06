// Índice do catálogo do estado atual.
//
// A v8.5.0 entrega a plataforma; nenhum provider novo entrou ainda. Este
// arquivo constrói o índice a partir do que já existe — ENEM e ITA — para
// que o Data Quality e o seletor de prova já leiam do índice, e não da
// forma antiga.
//
// Quando os importadores das próximas waves gerarem `catalog.generated.json`,
// esta função passa a lê-lo. A interface não muda junto: é esse o ponto de
// ter um índice.

import { CatalogIndex, type CatalogEntry } from "./index";
import { listProviders, itaAnswerKey, ITA_PROVIDER_ID } from "../providers";
import { listSources } from "../sources";
import type { ExamFamilyId } from "../sources/types";

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

/** Monta o índice a partir dos providers registrados. */
export function buildCurrentCatalog(): CatalogIndex {
  const entradas: CatalogEntry[] = [];

  for (const p of listProviders()) {
    const fonte = listSources().find((s) => s.providerId === p.id);
    if (!fonte) continue;

    // Só entram as fases cujas questões o app realmente tem. O ITA publica
    // 2ª fase, mas ela é discursiva e não foi ingerida — listá-la aqui com a
    // contagem da 1ª inflaria o catálogo com questões que não existem no
    // banco. Fase publicada não é fase ingerida.
    const fasesIngeridas =
      p.id === ITA_PROVIDER_ID
        ? p.metadata.phases.filter((f) => f === "first")
        : p.metadata.phases;

    for (const ano of p.metadata.years) {
      const chave = p.id === ITA_PROVIDER_ID ? itaAnswerKey(ano) : null;
      const contagem = chave?.total ?? null;
      const materias = chave
        ? Object.fromEntries(
            Object.entries(chave.subjects ?? {}).map(([nome, faixa]) => [
              nome,
              Array.isArray(faixa) ? faixa.length : Number(faixa) || 0,
            ]),
          )
        : {};

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
          validation: NIVEL_HERDADO,
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

  return new CatalogIndex(entradas, familias);
}
