// Índice do catálogo.
//
// O problema que este arquivo resolve (§29, §30): hoje o Banco chama
// `questionsFor(provider, ano)` e carrega a edição inteira só para montar um
// filtro. Com uma prova e quinze anos isso passa; com dezenas de
// instituições e milhares de questões, montar um dropdown viraria download
// de dezenas de megabytes.
//
// O índice é **metadata**, não conteúdo: quantas questões existem, de que
// matéria, com que nível de validação. O peso de uma edição inteira é uma
// linha. Questão só é carregada quando alguém vai responder.

import type { ExamFamilyId } from "../sources/types";
import type { ValidationLevel } from "../sources/ingestion";

/** Uma edição, do ponto de vista de quem só precisa listá-la. */
export interface CatalogEntry {
  providerId: string;
  /** Identidade da edição como a banca escreve ("2026", "2025-2026"). */
  editionId: string;
  year: number;
  phase: string;
  /**
   * Total de questões objetivas utilizáveis.
   *
   * `null` quando não é conhecido sem carregar a prova — é o caso de uma
   * fonte estruturada cuja contagem só aparece na resposta da API. Zero
   * seria a mesma mentira que o app já proíbe nos indicadores: ausência de
   * medição não é medição de zero.
   */
  questionCount: number | null;
  /** Contagem por matéria, na taxonomia do provider. */
  subjects: Record<string, number>;
  validation: ValidationLevel;
  sourceId: string;
  /** `false` quando o enunciado vive no documento oficial (modo referência). */
  statementAvailable: boolean;
  importerVersion: string;
}

export interface CatalogFilter {
  providerId?: string;
  providerIds?: string[];
  family?: ExamFamilyId;
  year?: number;
  minYear?: number;
  maxYear?: number;
  phase?: string;
  subject?: string;
  /** Níveis aceitos. Sem isto, o padrão exclui `provisional` e `blocked`. */
  validation?: ValidationLevel[];
  /** `true` para exigir enunciado no app; `false` para exigir modo referência. */
  statementAvailable?: boolean;
}

/** Níveis que entram no banco padrão (§6). */
const PADRAO: ValidationLevel[] = ["verified", "reviewed"];

/**
 * Índice consultável em memória.
 *
 * Em memória de propósito: o índice inteiro de dezenas de provas ainda é
 * pequeno — é uma linha por edição, não por questão. Trocar isto por
 * consulta em servidor só se justifica quando o índice em si crescer, e
 * `estimateSizeBytes` existe para essa decisão ser tomada com número, não
 * com pressentimento.
 */
export class CatalogIndex {
  private readonly entradas: CatalogEntry[];
  private readonly familiaDoProvider: Map<string, ExamFamilyId>;

  constructor(
    entradas: CatalogEntry[],
    familiaDoProvider: Record<string, ExamFamilyId> = {},
  ) {
    this.entradas = entradas;
    this.familiaDoProvider = new Map(Object.entries(familiaDoProvider));
  }

  /**
   * Edições que satisfazem o filtro.
   *
   * Sem `validation` explícito, devolve só `verified` e `reviewed`: quem
   * quiser material não conferido precisa pedir por escrito.
   */
  query(f: CatalogFilter = {}): CatalogEntry[] {
    const niveis = f.validation ?? PADRAO;

    return this.entradas.filter((e) => {
      if (!niveis.includes(e.validation)) return false;
      if (f.providerId && e.providerId !== f.providerId) return false;
      if (f.providerIds && !f.providerIds.includes(e.providerId)) return false;
      if (f.family && this.familiaDoProvider.get(e.providerId) !== f.family) return false;
      if (f.year !== undefined && e.year !== f.year) return false;
      if (f.minYear !== undefined && e.year < f.minYear) return false;
      if (f.maxYear !== undefined && e.year > f.maxYear) return false;
      if (f.phase && e.phase !== f.phase) return false;
      if (f.subject && !(f.subject in e.subjects)) return false;
      if (f.statementAvailable !== undefined && e.statementAvailable !== f.statementAvailable) {
        return false;
      }
      return true;
    });
  }

  /**
   * Quantas questões o filtro alcança, sem carregar nenhuma.
   *
   * Devolve também quantas edições não sabem informar: um total de 96 com
   * três edições desconhecidas é uma frase diferente de um total de 96.
   */
  countQuestions(f: CatalogFilter = {}): { known: number; unknownEditions: number } {
    const r = this.query(f);
    return {
      known: r.reduce((s, e) => s + (e.questionCount ?? 0), 0),
      unknownEditions: r.filter((e) => e.questionCount === null).length,
    };
  }

  /** Provas presentes no índice, na ordem em que aparecem. */
  providers(): string[] {
    return [...new Set(this.entradas.map((e) => e.providerId))];
  }

  /** Anos disponíveis de uma prova, do mais recente ao mais antigo. */
  yearsOf(providerId: string, f: Omit<CatalogFilter, "providerId"> = {}): number[] {
    return [...new Set(this.query({ ...f, providerId }).map((e) => e.year))].sort(
      (a, b) => b - a,
    );
  }

  /** Matérias de uma prova, com quantas questões cada uma tem. */
  subjectsOf(providerId: string, f: Omit<CatalogFilter, "providerId"> = {}): Record<string, number> {
    const total: Record<string, number> = {};
    for (const e of this.query({ ...f, providerId })) {
      for (const [s, n] of Object.entries(e.subjects)) total[s] = (total[s] ?? 0) + n;
    }
    return total;
  }

  /** Resumo por prova, para o Data Quality (§32). */
  summary(): CatalogSummary[] {
    const porProvider = new Map<string, CatalogSummary>();

    for (const e of this.entradas) {
      const atual = porProvider.get(e.providerId) ?? {
        providerId: e.providerId,
        editions: 0,
        questions: 0,
        verified: 0,
        reviewed: 0,
        provisional: 0,
        blocked: 0,
        referenceOnly: 0,
        unknownCount: 0,
      };
      atual.editions += 1;
      // Edição bloqueada não soma questão: ela não é usável em lugar nenhum,
      // e contá-la infla o tamanho aparente do banco.
      if (e.validation !== "blocked") atual.questions += e.questionCount ?? 0;
      if (e.questionCount === null) atual.unknownCount += 1;
      atual[e.validation] += 1;
      if (!e.statementAvailable) atual.referenceOnly += e.questionCount ?? 0;
      porProvider.set(e.providerId, atual);
    }

    return [...porProvider.values()].sort((a, b) => b.questions - a.questions);
  }

  /** Tamanho aproximado do índice serializado, para decidir sobre paginação. */
  estimateSizeBytes(): number {
    return JSON.stringify(this.entradas).length;
  }

  get size(): number {
    return this.entradas.length;
  }
}

export interface CatalogSummary {
  providerId: string;
  editions: number;
  questions: number;
  verified: number;
  reviewed: number;
  provisional: number;
  blocked: number;
  /** Questões cujo enunciado está no documento oficial, não no app. */
  referenceOnly: number;
  /** Edições cuja contagem só se sabe carregando a prova. */
  unknownCount: number;
}
