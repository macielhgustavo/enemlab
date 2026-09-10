// Taxonomia universal de conteúdo.
//
// O problema (§25): cada banca nomeia conteúdo do seu jeito. O ITA chama de
// "physics", o ENEM de "ciencias-natureza", o IME separa por caderno. Isso é
// correto e precisa continuar — a taxonomia do provider é o vocabulário da
// prova, e traduzi-la destruiria a leitura por banca.
//
// Mas o aluno que quer treinar "circuitos" não quer escolher a banca antes.
// Por isso existem **duas** taxonomias, e uma questão carrega as duas:
//
//   providerSubject: "physics"                    (o que a banca diz)
//   universalTopic:  "physics.electricity.circuits" (o que o assunto é)
//
// Nenhuma substitui a outra. O mapa de domínio continua por provider; o
// treino por conteúdo usa a universal.

/** Um nó da árvore universal. */
export interface UniversalTopic {
  /** Caminho pontuado: `physics.electricity.circuits`. */
  id: string;
  label: string;
  /** Nós filhos, quando houver. */
  children?: UniversalTopic[];
}

/**
 * A árvore.
 *
 * Deliberadamente rasa — três níveis no máximo. Uma taxonomia com sete
 * níveis fica impossível de classificar com confiança e ninguém navega até o
 * fim; e um classificador que precisa escolher entre 400 folhas erra mais do
 * que acerta.
 *
 * Cresce por necessidade demonstrada, não por completude teórica.
 */
export const UNIVERSAL_TAXONOMY: UniversalTopic[] = [
  {
    id: "mathematics",
    label: "Matemática",
    children: [
      {
        id: "mathematics.algebra",
        label: "Álgebra",
        children: [
          { id: "mathematics.algebra.functions", label: "Funções" },
          { id: "mathematics.algebra.polynomials", label: "Polinômios" },
          { id: "mathematics.algebra.sequences", label: "Sequências" },
          { id: "mathematics.algebra.complex", label: "Números complexos" },
        ],
      },
      {
        id: "mathematics.geometry",
        label: "Geometria",
        children: [
          { id: "mathematics.geometry.plane", label: "Plana" },
          { id: "mathematics.geometry.spatial", label: "Espacial" },
          { id: "mathematics.geometry.analytic", label: "Analítica" },
          { id: "mathematics.geometry.trigonometry", label: "Trigonometria" },
        ],
      },
      {
        id: "mathematics.combinatorics",
        label: "Combinatória e probabilidade",
        children: [
          { id: "mathematics.combinatorics.counting", label: "Contagem" },
          { id: "mathematics.combinatorics.probability", label: "Probabilidade" },
        ],
      },
      {
        id: "mathematics.statistics",
        label: "Estatística",
        children: [{ id: "mathematics.statistics.descriptive", label: "Descritiva" }],
      },
    ],
  },
  {
    id: "physics",
    label: "Física",
    children: [
      {
        id: "physics.mechanics",
        label: "Mecânica",
        children: [
          { id: "physics.mechanics.kinematics", label: "Cinemática" },
          { id: "physics.mechanics.dynamics", label: "Dinâmica" },
          { id: "physics.mechanics.energy", label: "Energia" },
          { id: "physics.mechanics.statics", label: "Estática" },
        ],
      },
      {
        id: "physics.electricity",
        label: "Eletricidade",
        children: [
          { id: "physics.electricity.electrostatics", label: "Eletrostática" },
          { id: "physics.electricity.circuits", label: "Circuitos" },
          { id: "physics.electricity.magnetism", label: "Magnetismo" },
        ],
      },
      {
        id: "physics.thermodynamics",
        label: "Termodinâmica",
        children: [
          { id: "physics.thermodynamics.heat", label: "Calor" },
          { id: "physics.thermodynamics.gases", label: "Gases" },
        ],
      },
      {
        id: "physics.waves",
        label: "Ondas e óptica",
        children: [
          { id: "physics.waves.optics", label: "Óptica" },
          { id: "physics.waves.oscillations", label: "Oscilações" },
        ],
      },
      { id: "physics.modern", label: "Física moderna" },
    ],
  },
  {
    id: "chemistry",
    label: "Química",
    children: [
      { id: "chemistry.general", label: "Química geral" },
      { id: "chemistry.organic", label: "Orgânica" },
      { id: "chemistry.physical", label: "Físico-química" },
      { id: "chemistry.inorganic", label: "Inorgânica" },
    ],
  },
  {
    id: "biology",
    label: "Biologia",
    children: [
      { id: "biology.cell", label: "Citologia" },
      { id: "biology.genetics", label: "Genética" },
      { id: "biology.ecology", label: "Ecologia" },
      { id: "biology.physiology", label: "Fisiologia" },
      { id: "biology.evolution", label: "Evolução" },
    ],
  },
  {
    id: "languages",
    label: "Linguagens",
    children: [
      { id: "languages.portuguese", label: "Português" },
      { id: "languages.literature", label: "Literatura" },
      { id: "languages.english", label: "Inglês" },
      { id: "languages.spanish", label: "Espanhol" },
    ],
  },
  {
    id: "humanities",
    label: "Humanas",
    children: [
      { id: "humanities.history", label: "História" },
      { id: "humanities.geography", label: "Geografia" },
      { id: "humanities.philosophy", label: "Filosofia" },
      { id: "humanities.sociology", label: "Sociologia" },
    ],
  },
];

/** Todos os nós, achatados, para busca e validação. */
const ACHATADA: Map<string, UniversalTopic> = (() => {
  const m = new Map<string, UniversalTopic>();
  const anda = (ns: UniversalTopic[]) => {
    for (const n of ns) {
      m.set(n.id, n);
      if (n.children) anda(n.children);
    }
  };
  anda(UNIVERSAL_TAXONOMY);
  return m;
})();

/**
 * Um id de disciplina raiz (`physics`, `mathematics`).
 *
 * Não é um tópico atribuível: ver `isUniversalTopic`.
 */
export function isUniversalDiscipline(id: string): boolean {
  return ACHATADA.has(id) && !id.includes(".");
}

/**
 * Um tópico que uma questão pode receber.
 *
 * Exige pelo menos dois níveis, e por dois motivos que se reforçam:
 *
 * 1. **Informação.** Marcar uma questão como "física" não diz nada que a
 *    matéria do provider já não diga.
 * 2. **Namespace.** As raízes colidem de propósito com as matérias de alguns
 *    providers — o ITA chama sua matéria de `physics`, igual à raiz daqui.
 *    Se a raiz fosse atribuível, um id solto seria ambíguo entre as duas
 *    taxonomias, e ambiguidade nesse ponto é como o desempenho de uma prova
 *    vaza para outra.
 */
export function isUniversalTopic(id: string): boolean {
  return ACHATADA.has(id) && id.includes(".");
}

export function universalTopic(id: string): UniversalTopic | null {
  return ACHATADA.get(id) ?? null;
}

/** Rótulo do tópico. Sem correspondência, devolve o id — não inventa nome. */
export function universalTopicLabel(id: string): string {
  return ACHATADA.get(id)?.label ?? id;
}

/**
 * Caminho legível: `Física › Eletricidade › Circuitos`.
 *
 * Reconstruído a partir do id, porque ele é hierárquico por construção.
 */
export function universalTopicPath(id: string): string[] {
  const partes = id.split(".");
  const caminho: string[] = [];
  for (let i = 1; i <= partes.length; i++) {
    const prefixo = partes.slice(0, i).join(".");
    const no = ACHATADA.get(prefixo);
    if (no) caminho.push(no.label);
  }
  return caminho;
}

/** Um tópico e todos os seus descendentes — para "circuitos em qualquer prova". */
export function universalSubtree(id: string): string[] {
  const raiz = ACHATADA.get(id);
  if (!raiz) return [];
  const out: string[] = [];
  const anda = (n: UniversalTopic) => {
    out.push(n.id);
    n.children?.forEach(anda);
  };
  anda(raiz);
  return out;
}

/** Um tópico está dentro de outro? Usado para filtrar por ramo. */
export function isWithinTopic(topico: string, ramo: string): boolean {
  return topico === ramo || topico.startsWith(ramo + ".");
}

/**
 * Classificação universal de uma questão.
 *
 * `confidence` não é enfeite. Quando um classificador não tem certeza, a
 * resposta certa é `null` com confiança baixa — §26 é explícito: não fingir
 * tópico preciso. Uma questão marcada errado como "circuitos" polui o treino
 * por conteúdo de quem confiou nele.
 */
export interface UniversalClassification {
  topic: string | null;
  confidence: "alta" | "media" | "baixa";
  /** O que sustentou a decisão, para alguém poder discordar com base. */
  evidence: string[];
}

/** Classificação honesta de "não sei". */
export const UNCLASSIFIED: UniversalClassification = {
  topic: null,
  confidence: "baixa",
  evidence: [],
};

/**
 * Só aceita a classificação quando ela se sustenta.
 *
 * Tópico inexistente ou confiança baixa viram `UNCLASSIFIED`. É melhor a
 * questão aparecer como não classificada do que aparecer no treino errado.
 */
export function acceptClassification(c: UniversalClassification): UniversalClassification {
  if (!c.topic) return UNCLASSIFIED;
  if (!isUniversalTopic(c.topic)) return UNCLASSIFIED;
  if (c.confidence === "baixa") return UNCLASSIFIED;
  return c;
}
