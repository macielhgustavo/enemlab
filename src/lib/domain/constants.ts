// Constantes de domínio (portadas do v6).
import type { AreaId } from "./types";

export const API_BASE = "https://api.enem.dev/v1";

export const FINAL_BUILD = "7.2-data-quality-2026.09";
export const FINAL_SCHEMA = 6.6;

export const LETTERS = ["A", "B", "C", "D", "E"] as const;

export const AREA_LABELS: Record<string, string> = {
  matematica: "Matemática",
  "ciencias-natureza": "Ciências da Natureza",
  "ciencias-humanas": "Ciências Humanas",
  linguagens: "Linguagens",
};

export const AREA_ORDER: AreaId[] = [
  "matematica",
  "ciencias-natureza",
  "linguagens",
  "ciencias-humanas",
];

export const REASONS = [
  "Conteúdo",
  "Interpretação",
  "Cálculo",
  "Desatenção",
  "Tempo/pressa",
  "Chute",
  "Dúvida entre alternativas",
];

export const BASELINE = {
  correct: 150,
  total: 180,
  areas: {
    Linguagens: [41, 45],
    Humanas: [44, 45],
    Natureza: [32, 45],
    Matemática: [33, 45],
  },
};

// Intervalos SRS (dias) por número de repetições acertadas.
export const SRS_INTERVALS = [0, 2, 7, 15, 30, 60];

export const ESSAY_THEMES: Record<number, string> = {
  2023: "Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil",
  2022: "Desafios para a valorização de comunidades e povos tradicionais no Brasil",
  2021: "Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil",
  2020: "O estigma associado às doenças mentais na sociedade brasileira",
  2019: "Democratização do acesso ao cinema no Brasil",
  2018: "Manipulação do comportamento do usuário pelo controle de dados na internet",
  2017: "Desafios para a formação educacional de surdos no Brasil",
  2016: "Caminhos para combater a intolerância religiosa no Brasil",
  2015: "A persistência da violência contra a mulher na sociedade brasileira",
  2014: "Publicidade infantil em questão no Brasil",
};

export const CONTENTS: Record<string, string[]> = {
  matematica: [
    "Porcentagem e juros",
    "Razão e proporcionalidade",
    "Aritmética e medidas",
    "Funções",
    "Geometria plana",
    "Geometria espacial",
    "Trigonometria",
    "Probabilidade",
    "Estatística",
    "Combinatória",
    "Sequências",
    "Leitura de gráficos",
    "Matemática • Não classificado",
  ],
  "ciencias-natureza": [
    "Física • Mecânica",
    "Física • Eletricidade",
    "Física • Termologia",
    "Física • Óptica e ondas",
    "Química • Estequiometria",
    "Química • Reações e separação",
    "Química • Soluções e pH",
    "Química • Interações intermoleculares",
    "Química • Orgânica",
    "Química • Eletroquímica",
    "Biologia • Ecologia",
    "Biologia • Genética",
    "Biologia • Imunologia",
    "Biologia • Botânica",
    "Biologia • Fisiologia",
    "Biologia • Evolução",
    "Biologia • Citologia e metabolismo",
    "Natureza • Não classificado",
  ],
  "ciencias-humanas": [
    "História do Brasil",
    "História Geral",
    "Geografia • Urbanização",
    "Geografia • Clima e ambiente",
    "Geografia • Geopolítica",
    "Geografia • Cartografia",
    "Sociologia",
    "Filosofia",
    "Trabalho e cidadania",
    "Humanas • Não classificado",
  ],
  linguagens: [
    "Interpretação textual",
    "Argumentação e gêneros",
    "Gramática em contexto",
    "Literatura",
    "Artes e cultura",
    "Variação linguística",
    "Língua estrangeira",
    "Tecnologia e mídia",
  ],
};

export function contentAllLabels(): string[] {
  return Object.values(CONTENTS).flat();
}

export const TAXONOMY: Record<string, string[]> = {
  "Porcentagem e juros": ["Matemática", "Aritmética", "Porcentagem e juros"],
  "Razão e proporcionalidade": ["Matemática", "Aritmética", "Razão e proporcionalidade"],
  "Aritmética e medidas": ["Matemática", "Aritmética", "Medidas e operações"],
  Funções: ["Matemática", "Álgebra", "Funções"],
  "Geometria plana": ["Matemática", "Geometria", "Plana"],
  "Geometria espacial": ["Matemática", "Geometria", "Espacial"],
  Trigonometria: ["Matemática", "Geometria", "Trigonometria"],
  Probabilidade: ["Matemática", "Probabilidade e estatística", "Probabilidade"],
  Estatística: ["Matemática", "Probabilidade e estatística", "Estatística"],
  Combinatória: ["Matemática", "Combinatória", "Contagem"],
  Sequências: ["Matemática", "Álgebra", "Sequências"],
  "Leitura de gráficos": ["Matemática", "Dados", "Gráficos"],
  "Matemática • Não classificado": ["Matemática", "Não classificado"],
  "Física • Mecânica": ["Natureza", "Física", "Mecânica"],
  "Física • Eletricidade": ["Natureza", "Física", "Eletricidade"],
  "Física • Termologia": ["Natureza", "Física", "Termologia"],
  "Física • Óptica e ondas": ["Natureza", "Física", "Óptica e ondas"],
  "Química • Estequiometria": ["Natureza", "Química", "Estequiometria"],
  "Química • Reações e separação": ["Natureza", "Química", "Reações e separação de misturas"],
  "Química • Soluções e pH": ["Natureza", "Química", "Soluções e pH"],
  "Química • Interações intermoleculares": ["Natureza", "Química", "Interações intermoleculares"],
  "Química • Orgânica": ["Natureza", "Química", "Orgânica"],
  "Química • Eletroquímica": ["Natureza", "Química", "Eletroquímica"],
  "Biologia • Ecologia": ["Natureza", "Biologia", "Ecologia"],
  "Biologia • Genética": ["Natureza", "Biologia", "Genética"],
  "Biologia • Imunologia": ["Natureza", "Biologia", "Imunologia"],
  "Biologia • Botânica": ["Natureza", "Biologia", "Botânica"],
  "Biologia • Fisiologia": ["Natureza", "Biologia", "Fisiologia"],
  "Biologia • Evolução": ["Natureza", "Biologia", "Evolução"],
  "Biologia • Citologia e metabolismo": ["Natureza", "Biologia", "Citologia e metabolismo"],
  "Natureza • Não classificado": ["Natureza", "Não classificado"],
  "História do Brasil": ["Humanas", "História", "Brasil"],
  "História Geral": ["Humanas", "História", "Geral"],
  "Geografia • Urbanização": ["Humanas", "Geografia", "Urbanização"],
  "Geografia • Clima e ambiente": ["Humanas", "Geografia", "Clima e ambiente"],
  "Geografia • Geopolítica": ["Humanas", "Geografia", "Geopolítica"],
  "Geografia • Cartografia": ["Humanas", "Geografia", "Cartografia"],
  Sociologia: ["Humanas", "Sociologia"],
  Filosofia: ["Humanas", "Filosofia"],
  "Trabalho e cidadania": ["Humanas", "Sociedade", "Trabalho e cidadania"],
  "Humanas • Não classificado": ["Humanas", "Não classificado"],
  "Interpretação textual": ["Linguagens", "Português", "Interpretação"],
  "Argumentação e gêneros": ["Linguagens", "Português", "Argumentação e gêneros"],
  "Gramática em contexto": ["Linguagens", "Português", "Gramática em contexto"],
  Literatura: ["Linguagens", "Literatura"],
  "Artes e cultura": ["Linguagens", "Artes e cultura"],
  "Variação linguística": ["Linguagens", "Português", "Variação linguística"],
  "Língua estrangeira": ["Linguagens", "Língua estrangeira"],
  "Tecnologia e mídia": ["Linguagens", "Tecnologia e mídia"],
};

export function contentPath(name: string): string[] {
  return TAXONOMY[name] || [name || "Outro"];
}

export function examYears(): number[] {
  const out: number[] = [];
  for (let y = 2023; y >= 2009; y--) out.push(y);
  return out;
}
