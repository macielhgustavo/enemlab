// Variantes de prova (caderno / versão).
//
// O problema concreto (§7, §19): o ENEM aplica quatro cadernos por dia —
// Azul, Amarelo, Branco, Rosa. **É a mesma prova em ordem diferente**, com
// um gabarito para cada. São 95 documentos só em 2025.
//
// Sem modelar isso, dois estragos acontecem ao mesmo tempo:
//
//   1. A mesma questão vira quatro questões no banco. Quem responde a de
//      número 5 do caderno Azul reencontra a mesma questão como número 23
//      do Amarelo, e o SRS a trata como nova.
//   2. Pior: o gabarito de um caderno corrige outro. Como a ordem muda, a
//      resposta da questão 5 do Azul não é a resposta da 5 do Amarelo.
//
// O segundo é o que torna isto bloqueante. Corrigir com o gabarito errado é
// ensinar a resposta errada.

/** Uma variante aplicada de uma edição. */
export interface ExamVariant {
  /** Identificador curto e estável: `cd1`, `azul`, `v1`. */
  id: string;
  /** Como a banca a chama: "Caderno 1 — Azul". */
  label: string;
  /** Gabarito próprio desta variante. */
  answerKeyUrl?: string;
  /** Caderno da prova desta variante. */
  examUrl?: string;
}

/**
 * Relação entre as variantes de uma edição.
 *
 * A diferença muda o que é correto fazer, então ela é explícita em vez de
 * inferida:
 *
 * - `reordered` — mesmas questões, ordem diferente (o caso do ENEM). Só uma
 *   variante deve ser ingerida como fonte das questões; as outras são
 *   referência. Ingerir todas cria duplicata.
 * - `distinct` — provas realmente diferentes aplicadas no mesmo concurso
 *   (acontece em concurso com códigos de prova). Cada uma é conteúdo
 *   próprio e todas podem ser ingeridas.
 * - `unknown` — não se sabe. Trata-se como `distinct` seria criar
 *   duplicata; como `reordered` seria perder conteúdo. A saída honesta é
 *   ingerir uma só e registrar as demais.
 */
export type VariantRelation = "reordered" | "distinct" | "unknown";

export interface EditionVariants {
  relation: VariantRelation;
  variants: ExamVariant[];
  /**
   * Variante de onde as questões saem, quando `relation` não é `distinct`.
   *
   * Escolher uma é decisão de ingestão, não de conteúdo: as questões são as
   * mesmas, e fixar uma torna a numeração estável entre importações.
   */
  canonical?: string;
}

/**
 * Quais variantes devem virar questões no catálogo.
 *
 * Regra: `distinct` ingere todas; qualquer outra coisa ingere só a canônica.
 * `unknown` cai no caso conservador de propósito — duplicar o banco é um
 * estrago maior e mais difícil de desfazer que deixar conteúdo de fora.
 */
export function variantsToIngest(e: EditionVariants): ExamVariant[] {
  if (e.relation === "distinct") return e.variants;

  const canonica = e.canonical
    ? e.variants.find((v) => v.id === e.canonical)
    : e.variants[0];
  return canonica ? [canonica] : [];
}

/** Variantes que ficam só como referência ao documento oficial. */
export function variantsForReference(e: EditionVariants): ExamVariant[] {
  const ingeridas = new Set(variantsToIngest(e).map((v) => v.id));
  return e.variants.filter((v) => !ingeridas.has(v.id));
}

/**
 * A variante entra na chave da questão?
 *
 * Só quando as variantes são conteúdo diferente. Numa prova reordenada, pôr
 * o caderno na chave criaria quatro identidades para a mesma questão — que
 * é exatamente o que se quer evitar.
 */
export function variantBelongsInKey(relation: VariantRelation): boolean {
  return relation === "distinct";
}

export interface AnswerKeyMismatch {
  number: number;
  variantA: string;
  letterA: string;
  variantB: string;
  letterB: string;
}

/**
 * Confere se dois gabaritos de variantes reordenadas são compatíveis.
 *
 * Numa prova reordenada, o gabarito **precisa** divergir entre cadernos: a
 * questão 5 do Azul não é a 5 do Amarelo. Dois gabaritos idênticos são
 * sinal de que o importador leu o mesmo arquivo duas vezes, ou de que a
 * relação declarada está errada.
 *
 * Devolve as divergências. Lista vazia numa prova declarada `reordered` é
 * um alerta, não uma aprovação — por isso `suspiciouslyIdentical`.
 */
export function compareVariantKeys(
  a: { variant: string; answers: Record<number, string> },
  b: { variant: string; answers: Record<number, string> },
): { mismatches: AnswerKeyMismatch[]; suspiciouslyIdentical: boolean } {
  const mismatches: AnswerKeyMismatch[] = [];
  const numeros = new Set([...Object.keys(a.answers), ...Object.keys(b.answers)].map(Number));

  for (const n of [...numeros].sort((x, y) => x - y)) {
    const la = a.answers[n];
    const lb = b.answers[n];
    if (la && lb && la !== lb) {
      mismatches.push({ number: n, variantA: a.variant, letterA: la, variantB: b.variant, letterB: lb });
    }
  }

  return { mismatches, suspiciouslyIdentical: mismatches.length === 0 && numeros.size > 0 };
}
