// Integridade do gabarito.
//
// Este é o dado mais crítico da plataforma. Enunciado errado o aluno percebe;
// gabarito errado ensina a resposta errada e ainda contamina o histórico, o
// SRS e o mapa de domínio — o estrago se espalha silenciosamente.
//
// Por isso tudo aqui recusa em vez de adivinhar.

import type { DocumentFingerprint } from "./ingestion";

/**
 * Qual publicação do gabarito é esta.
 *
 * Bancas publicam um preliminar logo após a aplicação, abrem recurso, e
 * depois publicam o final — que pode trocar respostas e anular questões. Um
 * importador que pegar o primeiro que encontrar vai corrigir prova com a
 * resposta revogada.
 */
export type AnswerKeyRevision = "preliminary" | "final" | "rectified";

export interface AnswerKeyDocument {
  revision: AnswerKeyRevision;
  /** Revisão que esta substitui, quando aplicável. */
  supersedes?: AnswerKeyRevision;
  publishedAt?: string;
  /** Número da questão → letra. Anuladas não aparecem aqui. */
  answers: Record<number, string>;
  annulled: number[];
  fingerprint: DocumentFingerprint;
  /** Variante/caderno a que este gabarito se aplica, quando há versões. */
  variant?: string;
}

/** Ordem de precedência: mais alto vence. */
const PRECEDENCIA: Record<AnswerKeyRevision, number> = {
  rectified: 3,
  final: 2,
  preliminary: 1,
};

/**
 * Escolhe o gabarito que vale.
 *
 * Regra do §9: **usar o FINAL**. Retificação posterior vence o final; o
 * preliminar só é usado quando é o único que existe — e nesse caso quem
 * chama precisa saber, por isso o retorno diz `onlyPreliminary`.
 */
export function selectAuthoritativeKey(docs: AnswerKeyDocument[]): {
  key: AnswerKeyDocument | null;
  onlyPreliminary: boolean;
  superseded: AnswerKeyDocument[];
} {
  if (!docs.length) return { key: null, onlyPreliminary: false, superseded: [] };

  const ordenados = [...docs].sort(
    (a, b) => PRECEDENCIA[b.revision] - PRECEDENCIA[a.revision],
  );
  const escolhido = ordenados[0];

  return {
    key: escolhido,
    onlyPreliminary: escolhido.revision === "preliminary",
    superseded: ordenados.slice(1),
  };
}

export interface AnswerKeyProblem {
  code:
    | "out-of-range"
    | "duplicate"
    | "invalid-letter"
    | "annulled-with-answer"
    | "gap"
    | "empty";
  message: string;
  numbers?: number[];
}

/**
 * Confere um gabarito contra o que a prova declara.
 *
 * Devolve a lista de problemas. Lista vazia é a única forma de aprovar —
 * não existe "aprovado com ressalvas" aqui.
 */
export function inspectAnswerKey(
  doc: AnswerKeyDocument,
  esperado: { total: number; allowedLetters: string[] },
): AnswerKeyProblem[] {
  const problemas: AnswerKeyProblem[] = [];
  const { total, allowedLetters } = esperado;

  const numeros = Object.keys(doc.answers).map(Number);
  if (!numeros.length && !doc.annulled.length) {
    problemas.push({ code: "empty", message: "gabarito sem nenhuma resposta" });
    return problemas;
  }

  const foraDoIntervalo = [...numeros, ...doc.annulled].filter(
    (n) => !Number.isInteger(n) || n < 1 || n > total,
  );
  if (foraDoIntervalo.length) {
    problemas.push({
      code: "out-of-range",
      message: `questão fora de 1..${total}`,
      numbers: foraDoIntervalo.sort((a, b) => a - b),
    });
  }

  // Uma questão anulada não pode ter resposta: se tem, uma das duas fontes
  // está errada e não há como saber qual.
  const anuladaComResposta = doc.annulled.filter((n) => doc.answers[n] !== undefined);
  if (anuladaComResposta.length) {
    problemas.push({
      code: "annulled-with-answer",
      message: "questão anulada com resposta atribuída",
      numbers: anuladaComResposta.sort((a, b) => a - b),
    });
  }

  const letrasRuins = numeros.filter((n) => !allowedLetters.includes(doc.answers[n]));
  if (letrasRuins.length) {
    problemas.push({
      code: "invalid-letter",
      message: `letra fora de [${allowedLetters.join("")}]`,
      numbers: letrasRuins.sort((a, b) => a - b),
    });
  }

  // Cobertura contígua: toda questão de 1 a N precisa ter resposta ou estar
  // anulada. Buraco no meio quase sempre é falha de parser, não da banca.
  const cobertas = new Set([...numeros, ...doc.annulled]);
  const buracos: number[] = [];
  for (let n = 1; n <= total; n++) if (!cobertas.has(n)) buracos.push(n);
  if (buracos.length) {
    problemas.push({
      code: "gap",
      message: `sem cobertura em ${buracos.length} questão(ões)`,
      numbers: buracos,
    });
  }

  return problemas;
}

/**
 * Compara dois gabaritos da mesma edição.
 *
 * Serve para a retificação: mostra exatamente o que mudou, para o relatório
 * dizer quais respostas o app estava usando erradas.
 */
export function diffAnswerKeys(
  antes: AnswerKeyDocument,
  depois: AnswerKeyDocument,
): {
  changed: { number: number; from: string; to: string }[];
  newlyAnnulled: number[];
  unannulled: number[];
} {
  const changed: { number: number; from: string; to: string }[] = [];
  for (const [k, v] of Object.entries(depois.answers)) {
    const n = Number(k);
    const anterior = antes.answers[n];
    if (anterior !== undefined && anterior !== v) {
      changed.push({ number: n, from: anterior, to: v });
    }
  }
  const newlyAnnulled = depois.annulled.filter((n) => !antes.annulled.includes(n));
  const unannulled = antes.annulled.filter((n) => !depois.annulled.includes(n));

  return {
    changed: changed.sort((a, b) => a.number - b.number),
    newlyAnnulled: newlyAnnulled.sort((a, b) => a - b),
    unannulled: unannulled.sort((a, b) => a - b),
  };
}
