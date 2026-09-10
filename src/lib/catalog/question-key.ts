// Identidade de uma questão.
//
// A chave é o que liga uma questão ao histórico, ao SRS e ao mapa de
// domínio. Se ela colidir entre provas, o desempenho de uma banca vaza para
// outra — o defeito que a v8.0.1 passou inteira consertando. Se ela mudar
// entre importações, o aluno perde o histórico daquela questão.
//
// Por isso a chave é **determinística** e feita só de identidade estrutural:
// provider, edição, fase, variante e número. Nunca do texto do enunciado
// (§7): um enunciado reextraído com um espaço a mais viraria outra questão.

/** Partes que identificam uma questão de forma única. */
export interface QuestionIdentity {
  providerId: string;
  /** Edição como a banca escreve: "2026", "2025-2026". */
  editionId: string;
  phase: string;
  /** Numeração oficial dentro da prova. */
  number: number;
  /**
   * Caderno/versão, quando a banca aplica variantes.
   *
   * Só entra na chave quando existe. Colocar "v1" em prova sem versão
   * criaria chaves diferentes para a mesma questão a cada mudança de
   * modelagem.
   */
  variant?: string;
  /** Idioma, para provas com prova estrangeira opcional. */
  language?: string | null;
}

const SEGMENTO_VALIDO = /^[a-z0-9][a-z0-9-]*$/;

function normaliza(parte: string): string {
  return (
    parte
      .toLowerCase()
      .normalize("NFD")
      // `\p{Diacritic}` nomeia a categoria Unicode em vez de escrever o
      // intervalo. Escrito como intervalo literal, os caracteres combinantes
      // ficam invisíveis no editor e no diff — e um deles perdido numa edição
      // quebraria a normalização sem ninguém ver.
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/**
 * Monta a chave.
 *
 * Formato: `provider-edicao-fase[-variante][-idioma]-numero`
 * Exemplos: `ime-2025-2026-objective-17`, `fuvest-2026-first-v1-34`
 *
 * Lança quando alguma parte não sobrevive à normalização: chave silenciosa
 * e malformada é pior que erro na ingestão, porque o estrago só aparece
 * depois, no histórico de alguém.
 */
export function buildQuestionKey(id: QuestionIdentity): string {
  if (!Number.isInteger(id.number) || id.number < 1) {
    throw new Error(`número de questão inválido: ${id.number}`);
  }

  const partes = [
    normaliza(id.providerId),
    normaliza(id.editionId),
    normaliza(id.phase),
    ...(id.variant ? [normaliza(id.variant)] : []),
    ...(id.language ? [normaliza(id.language)] : []),
  ];

  for (const p of partes) {
    if (!SEGMENTO_VALIDO.test(p)) {
      throw new Error(`parte de chave inválida em ${JSON.stringify(id)}: "${p}"`);
    }
  }

  return [...partes, String(id.number)].join("-");
}

/**
 * Lê uma chave de volta.
 *
 * Devolve `null` para chave irreconhecível em vez de chutar. Só o número
 * final e o provider são recuperáveis com certeza — edição e fase podem
 * conter hífen, e desfazer isso exigiria adivinhar onde uma termina.
 */
export function parseQuestionKeyProvider(chave: string): string | null {
  const primeiro = chave.split("-")[0];
  return primeiro && SEGMENTO_VALIDO.test(primeiro) ? primeiro : null;
}

export function parseQuestionKeyNumber(chave: string): number | null {
  const ultimo = chave.split("-").pop();
  const n = Number(ultimo);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Duas questões são a mesma?
 *
 * Existe para o problema do §7: quando uma banca aplica versões que são só
 * reordenação, a mesma questão aparece com números diferentes em cada
 * caderno. `officialId` é a saída — quando a banca publica um identificador
 * próprio, ele resolve; sem ele, não há como saber sem comparar conteúdo, e
 * comparar conteúdo é exatamente o que não queremos como identidade.
 */
export function sameQuestion(
  a: QuestionIdentity & { officialId?: string },
  b: QuestionIdentity & { officialId?: string },
): boolean {
  if (a.officialId && b.officialId) return a.officialId === b.officialId;
  return buildQuestionKey(a) === buildQuestionKey(b);
}
