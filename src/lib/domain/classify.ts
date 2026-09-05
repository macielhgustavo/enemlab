// Classificação automática de conteúdo — v7.2.
// Em vez de "primeiro regex que bate", pontua evidências, expõe confiança,
// aceita múltiplas tags e evita fingir precisão quando o texto é ambíguo.
import { CONTENTS, contentAllLabels, contentPath } from "./constants";
import { normalizeText } from "../format";
import type { Question } from "./types";

export type ClassificationConfidence = "alta" | "media" | "baixa";

export interface QuestionClassification {
  primary: string;
  tags: string[];
  path: string[];
  subtopic: string | null;
  confidence: ClassificationConfidence;
  score: number;
  margin: number;
  evidence: string[];
}

type Signal = { re: RegExp; weight: number; evidence: string };
type TopicRule = { label: string; signals: Signal[] };
type SubtopicRule = { label: string; re: RegExp; weight: number };

const s = (re: RegExp, weight: number, evidence: string): Signal => ({ re, weight, evidence });
const topic = (label: string, ...signals: Signal[]): TopicRule => ({ label, signals });

export function discipline(q: Question): string {
  if (typeof q.discipline === "string") return q.discipline;
  return q.discipline?.value || q.discipline?.label || "";
}

export function questionKey(q: Question): string {
  return `${q.year}-${q.index}-${q.language || "pt"}-${discipline(q)}`;
}

const RULES: Record<string, TopicRule[]> = {
  matematica: [
    topic(
      "Porcentagem e juros",
      s(/juros compost|montante|capital inicial|capital aplicado/, 8, "juros compostos"),
      s(/porcent|percentual|desconto|acrescimo|taxa percentual/, 6, "porcentagem/taxa"),
      s(/\b\d+[,.]?\d*\s*%/, 3, "valor percentual"),
    ),
    topic(
      "Probabilidade",
      s(/probabil/, 9, "probabilidade"),
      s(/chance|sorteio|aleatori|evento independente/, 6, "evento aleatório"),
      s(/urna|lancamento de dado|moeda|cara ou coroa/, 3, "experimento aleatório"),
    ),
    topic(
      "Estatística",
      s(/mediana|moda|desvio padrao|variancia|media aritmet/, 9, "medida estatística"),
      s(/histograma|frequencia|amostra estat|distribuicao/, 6, "distribuição/amostra"),
      s(/media dos valores|valor medio/, 4, "média"),
    ),
    topic(
      "Combinatória",
      s(/combinator|permut|arranjo/, 9, "análise combinatória"),
      s(/quantas maneiras|de quantas formas|possibilidades distintas/, 6, "contagem de possibilidades"),
      s(/fatorial/, 5, "fatorial"),
    ),
    topic(
      "Trigonometria",
      s(/seno|cosseno|tangente|trigonom/, 9, "razão trigonométrica"),
      s(/lei dos senos|lei dos cossenos/, 9, "lei trigonométrica"),
      s(/angulo de elevacao|angulo de inclinacao/, 4, "ângulo aplicado"),
    ),
    topic(
      "Geometria espacial",
      s(/cilindro|cone|esfera|prisma|piramide|paralelepip|cubo/, 7, "sólido geométrico"),
      s(/volume|area lateral|area total do solido/, 5, "medida espacial"),
      s(/planificacao/, 4, "planificação"),
    ),
    topic(
      "Geometria plana",
      s(/pitagor|semelhanca de triang|teorema de tales/, 9, "teorema geométrico"),
      s(/circunferencia|circulo|triangulo|quadrilatero|poligono|losango|trapezio/, 6, "figura plana"),
      s(/perimetro|area do triang|area do circul|area da figura/, 5, "medida plana"),
    ),
    topic(
      "Funções",
      s(/funcao|f\s*\(\s*x\s*\)/, 8, "função"),
      s(/funcao afim|funcao quadrat|funcao exponencial|funcao logarit/, 9, "tipo de função"),
      s(/equacao do segundo grau|equacao quadrat/, 6, "equação quadrática"),
      s(/crescimento exponencial|decaimento exponencial/, 6, "modelo exponencial"),
    ),
    topic(
      "Sequências",
      s(/progressao aritmet|progressao geometr/, 9, "progressão"),
      s(/sequencia|termo geral/, 6, "sequência"),
      s(/\bpa\b|\bpg\b/, 5, "PA/PG"),
    ),
    topic(
      "Razão e proporcionalidade",
      s(/regra de tres|grandezas proporcion|diretamente proporcional|inversamente proporcional/, 9, "proporcionalidade"),
      s(/escala cartograf|escala de 1:|escala 1:/, 8, "escala"),
      s(/razao entre|proporcao/, 6, "razão/proporção"),
      s(/velocidade media|densidade demograf|vazao/, 4, "razão aplicada"),
    ),
    topic(
      "Aritmética e medidas",
      s(/conversao de unidade|unidade de medida|metro quadrado|metro cubico/, 7, "unidades e medidas"),
      s(/mm|cm|km|litro|mililitro|quilograma|tonelada/, 2, "unidade física"),
      s(/divisibilidade|multiplo|divisor|mdc|mmc/, 6, "aritmética"),
    ),
    topic(
      "Leitura de gráficos",
      s(/grafico|histograma|diagrama/, 4, "gráfico"),
      s(/tabela|eixo horizontal|eixo vertical/, 3, "tabela/eixos"),
      s(/variacao ao longo|serie historica/, 3, "leitura de série"),
    ),
  ],
  "ciencias-natureza": [
    topic(
      "Física • Eletricidade",
      s(/circuito|corrente eletr|tensao eletr|resistencia eletr|lei de ohm/, 9, "circuitos"),
      s(/potencia eletr|energia eletr|consumo de energia|kwh/, 8, "potência/energia elétrica"),
      s(/transformador|transmissao de energia|rede eletr|linha de transmissao/, 8, "transmissão elétrica"),
      s(/campo eletr|carga eletr|eletrostat/, 7, "eletrostática"),
    ),
    topic(
      "Física • Mecânica",
      s(/segunda lei de newton|forca resultante|leis de newton/, 9, "dinâmica"),
      s(/velocidade|aceleracao|movimento uniforme|movimento uniformemente/, 6, "cinemática"),
      s(/trabalho mecan|energia cinet|energia potencial|conservacao da energia mecan/, 8, "trabalho e energia"),
      s(/pressao hidrostat|empuxo|principio de arquimedes/, 7, "hidrostática"),
    ),
    topic(
      "Física • Termologia",
      s(/calor especifico|calor latente|calorimetr/, 9, "calorimetria"),
      s(/temperatura|equilibrio termico|dilatacao term/, 6, "temperatura/dilatação"),
      s(/gas ideal|transformacao gasosa|primeira lei da termodinam|termodinam/, 8, "termodinâmica"),
    ),
    topic(
      "Física • Óptica e ondas",
      s(/espelho|lente|refracao|reflexao total|indice de refracao/, 9, "óptica"),
      s(/onda|frequencia|comprimento de onda|interferencia|difracao/, 8, "ondas"),
      s(/som|acustic|efeito doppler/, 7, "acústica"),
      s(/luz|espectro eletromagnet/, 4, "luz/espectro"),
    ),
    topic(
      "Química • Estequiometria",
      s(/estequiometr|massa molar|numero de mol|quantidade de materia/, 9, "estequiometria"),
      s(/balanceamento|coeficiente estequiometr/, 7, "balanceamento"),
      s(/rendimento da reacao|reagente limitante/, 8, "rendimento/reagente limitante"),
    ),
    topic(
      "Química • Reações e separação",
      s(/separacao de mistura|destilacao|filtracao|decantacao|centrifugacao|cromatografia/, 9, "separação de misturas"),
      s(/reacao quim|equacao quim|precipitacao|neutralizacao/, 6, "reação química"),
      s(/mistura homogene|mistura heterogene/, 5, "misturas"),
    ),
    topic(
      "Química • Soluções e pH",
      s(/\bph\b|\bpoh\b|acidez|basicidade/, 9, "pH/acidez"),
      s(/concentracao molar|molaridade|diluicao|solubilidade/, 8, "concentração/solubilidade"),
      s(/solucao aquosa|acido|base/, 4, "solução ácido-base"),
    ),
    topic(
      "Química • Interações intermoleculares",
      s(/interacao intermolecular|forca intermolecular|ligacao de hidrogenio|ponte de hidrogenio/, 9, "forças intermoleculares"),
      s(/dipolo|forcas de london|polaridade da molecula|molecula polar|molecula apolar/, 8, "polaridade"),
      s(/ponto de ebulicao|ponto de fusao/, 4, "propriedade intermolecular"),
    ),
    topic(
      "Química • Eletroquímica",
      s(/pilha|eletrolise|eletrodo|potencial de reducao/, 9, "eletroquímica"),
      s(/oxidacao|reducao|oxirredu|anodo|catodo/, 7, "oxirredução"),
    ),
    topic(
      "Química • Orgânica",
      s(/hidrocarbon|alcool|aldeido|cetona|ester|eter|amina|amida|acido carboxil/, 8, "função orgânica"),
      s(/polimero|isomer|quimica organica/, 7, "orgânica"),
      s(/cadeia carbonica|carbono quiral/, 6, "estrutura orgânica"),
    ),
    topic(
      "Biologia • Imunologia",
      s(/anticorpo|antigeno|linfocito|imunidade|resposta imune/, 9, "resposta imune"),
      s(/vacina|soro terapeut|imunizacao/, 8, "imunização"),
    ),
    topic(
      "Biologia • Genética",
      s(/dna|rna|gene|alelo|cromossom|genotipo|fenotipo/, 8, "genética molecular/clássica"),
      s(/hereditar|mendel|mutacao genet/, 8, "hereditariedade"),
    ),
    topic(
      "Biologia • Botânica",
      s(/xilema|floema|estomato|auxina|giberelina|fitormon/, 9, "fisiologia vegetal"),
      s(/planta|vegetal|germinacao|transpiracao vegetal|fototropismo/, 5, "botânica"),
    ),
    topic(
      "Biologia • Ecologia",
      s(/ecossistema|cadeia alimentar|teia alimentar|nivel trofico/, 9, "relações ecológicas"),
      s(/populacao|comunidade|bioma|biodivers|sucessao ecolog/, 7, "ecologia"),
      s(/impacto ambiental|eutrofizacao|bioacumulacao/, 6, "impacto ambiental"),
    ),
    topic(
      "Biologia • Fisiologia",
      s(/sistema nervoso|sistema digest|sistema respirat|sistema circulat|sistema endocrin/, 9, "fisiologia humana"),
      s(/hormon|sangue|rim|coracao|pulmao|digestao/, 6, "órgãos e sistemas"),
    ),
    topic(
      "Biologia • Evolução",
      s(/selecao natural|deriva genet|especiacao|ancestral comum/, 9, "mecanismo evolutivo"),
      s(/evolucao|adaptacao evolut|darwin|lamarck/, 7, "evolução"),
    ),
    topic(
      "Biologia • Citologia e metabolismo",
      s(/mitocond|ribossom|membrana plasmat|organelas|citoplasma/, 8, "citologia"),
      s(/respiracao celular|fotossintese|fermentacao|atp|metabolismo/, 9, "metabolismo"),
      s(/mitose|meiose|ciclo celular/, 7, "divisão celular"),
    ),
  ],
  "ciencias-humanas": [
    topic(
      "História do Brasil",
      s(/brasil colonia|periodo colonial|escravidao no brasil|imperio do brasil/, 8, "Brasil colonial/imperial"),
      s(/era vargas|estado novo|ditadura militar|republica velha|redemocratizacao/, 8, "Brasil republicano"),
      s(/independencia do brasil|abolicao da escravatura/, 7, "processo histórico brasileiro"),
    ),
    topic(
      "História Geral",
      s(/revolucao francesa|revolucao industrial|guerra fria|primeira guerra|segunda guerra/, 9, "história contemporânea"),
      s(/idade media|feudalismo|renascimento|reforma protestante/, 8, "história europeia"),
      s(/nazismo|fascismo|imperialismo|colonialismo/, 7, "ideologias/imperialismo"),
    ),
    topic(
      "Geografia • Urbanização",
      s(/urbanizacao|metropole|conurbacao|rede urbana|hierarquia urbana/, 9, "urbanização"),
      s(/mobilidade urbana|segregacao socioespacial|periferizacao/, 8, "dinâmica urbana"),
    ),
    topic(
      "Geografia • Clima e ambiente",
      s(/clima|massa de ar|precipitacao|chuva|efeito estufa/, 7, "clima"),
      s(/desmatamento|aquecimento global|mudanca climatica|vegetacao|bioma/, 7, "ambiente"),
      s(/erosao|solo|assoreamento|desertificacao/, 6, "solo/processos ambientais"),
    ),
    topic(
      "Geografia • Geopolítica",
      s(/geopolit|fronteira|territorio|conflito territorial|bloco economico/, 8, "geopolítica"),
      s(/globalizacao|migracao internacional|refugiado|ordem mundial/, 7, "globalização/migração"),
    ),
    topic(
      "Geografia • Cartografia",
      s(/latitude|longitude|projecao cartograf|coordenada geograf/, 9, "cartografia"),
      s(/escala cartograf|mapa tematico|fusos horarios/, 8, "representação cartográfica"),
    ),
    topic(
      "Sociologia",
      s(/classe social|estratificacao|desigualdade social|movimento social|socializacao/, 8, "sociologia"),
      s(/cultura de massa|industria cultural|identidade coletiva/, 6, "cultura/sociedade"),
    ),
    topic(
      "Filosofia",
      s(/epistemologia|racionalismo|empirismo|etica filosof|filosof/, 8, "filosofia"),
      s(/moral|razao|conhecimento|contrato social/, 5, "conceito filosófico"),
    ),
    topic(
      "Trabalho e cidadania",
      s(/cidadania|direitos civis|direitos sociais|direitos politicos|democracia/, 8, "cidadania/direitos"),
      s(/relacoes de trabalho|trabalho assalariado|precarizacao|sindicato/, 7, "trabalho"),
    ),
  ],
  linguagens: [
    topic(
      "Língua estrangeira",
      s(/\benglish\b|\bspanish\b|lingua inglesa|lingua espanhola/, 8, "língua estrangeira"),
    ),
    topic(
      "Literatura",
      s(/poema|romance|conto literario|narrador|modernismo|literatura/, 8, "literatura"),
      s(/eu lirico|figura de linguagem|movimento literario/, 7, "análise literária"),
    ),
    topic(
      "Gramática em contexto",
      s(/coesao|coerencia|sintaxe|pontuacao|concordancia|regencia/, 8, "gramática/coerência"),
      s(/pronome|conectivo|semantica|efeito de sentido da palavra/, 6, "recurso linguístico"),
    ),
    topic(
      "Argumentação e gêneros",
      s(/argument|tese|editorial|artigo de opiniao|carta aberta/, 8, "argumentação"),
      s(/genero textual|campanha publicitaria|publicidade|anuncio/, 7, "gênero textual"),
    ),
    topic(
      "Artes e cultura",
      s(/pintura|escultura|teatro|danca|performance artistica|obra de arte/, 8, "artes"),
      s(/musica|cultura popular|patrimonio cultural/, 6, "cultura"),
    ),
    topic(
      "Variação linguística",
      s(/variacao linguistica|norma padrao|preconceito linguistico|dialeto/, 9, "variação linguística"),
      s(/registro formal|registro informal|oralidade/, 6, "registro/oralidade"),
    ),
    topic(
      "Tecnologia e mídia",
      s(/rede social|internet|midia digital|algoritmo|plataforma digital/, 8, "mídia digital"),
      s(/tecnologia da informacao|comunicacao digital/, 6, "tecnologia/comunicação"),
    ),
    topic(
      "Interpretação textual",
      s(/texto|trecho|autor|leitor|efeito de sentido|finalidade do texto/, 2, "compreensão textual"),
    ),
  ],
};

const FALLBACK: Record<string, string> = {
  matematica: "Matemática • Não classificado",
  "ciencias-natureza": "Natureza • Não classificado",
  "ciencias-humanas": "Humanas • Não classificado",
  linguagens: "Interpretação textual",
};

const SUBTOPICS: Record<string, SubtopicRule[]> = {
  "Porcentagem e juros": [
    { label: "Juros compostos", re: /juros compost|montante|capital aplicado/, weight: 8 },
    { label: "Porcentagem e variação percentual", re: /porcent|percentual|desconto|acrescimo/, weight: 6 },
  ],
  "Geometria plana": [
    { label: "Teorema de Pitágoras", re: /pitagor/, weight: 9 },
    { label: "Circunferência e círculo", re: /circunferencia|circulo/, weight: 7 },
    { label: "Semelhança e Tales", re: /semelhanca|teorema de tales/, weight: 8 },
  ],
  "Geometria espacial": [
    { label: "Cilindros", re: /cilindro/, weight: 8 },
    { label: "Prismas e paralelepípedos", re: /prisma|paralelepip|cubo/, weight: 7 },
    { label: "Cones e pirâmides", re: /cone|piramide/, weight: 7 },
  ],
  Funções: [
    { label: "Função afim", re: /funcao afim|funcao linear/, weight: 8 },
    { label: "Função quadrática", re: /funcao quadrat|segundo grau/, weight: 8 },
    { label: "Função exponencial", re: /exponencial/, weight: 8 },
    { label: "Função logarítmica", re: /logarit/, weight: 8 },
  ],
  "Física • Eletricidade": [
    { label: "Circuitos elétricos", re: /circuito|lei de ohm|resistencia eletr|corrente eletr/, weight: 9 },
    { label: "Potência e energia elétrica", re: /potencia eletr|energia eletr|consumo de energia|kwh/, weight: 9 },
    { label: "Transmissão e transformadores", re: /transformador|transmissao de energia|linha de transmissao/, weight: 9 },
  ],
  "Física • Óptica e ondas": [
    { label: "Óptica geométrica", re: /espelho|lente|refracao|reflexao/, weight: 9 },
    { label: "Ondulatória", re: /onda|frequencia|comprimento de onda|interferencia|difracao/, weight: 8 },
    { label: "Acústica", re: /som|acustic|doppler/, weight: 8 },
  ],
  "Química • Reações e separação": [
    { label: "Separação de misturas", re: /destilacao|filtracao|decantacao|centrifugacao|cromatografia/, weight: 9 },
    { label: "Reações químicas", re: /reacao quim|equacao quim|precipitacao|neutralizacao/, weight: 7 },
  ],
  "Química • Interações intermoleculares": [
    { label: "Ligações de hidrogênio", re: /ligacao de hidrogenio|ponte de hidrogenio/, weight: 9 },
    { label: "Polaridade e dipolos", re: /dipolo|polaridade|molecula polar|molecula apolar/, weight: 8 },
  ],
  "Biologia • Imunologia": [
    { label: "Vacinas e soros", re: /vacina|soro terapeut|imunizacao/, weight: 9 },
    { label: "Resposta imune", re: /anticorpo|antigeno|linfocito|resposta imune/, weight: 8 },
  ],
  "Biologia • Botânica": [
    { label: "Fisiologia vegetal", re: /xilema|floema|estomato|fitormon|auxina|giberelina/, weight: 9 },
  ],
  "Biologia • Citologia e metabolismo": [
    { label: "Respiração celular", re: /respiracao celular|mitocond|atp/, weight: 8 },
    { label: "Fotossíntese", re: /fotossintese|cloroplast/, weight: 8 },
    { label: "Divisão celular", re: /mitose|meiose|ciclo celular/, weight: 8 },
  ],
};

function questionText(q: Question): string {
  return normalizeText(
    [q.context, q.alternativesIntroduction, ...(q.alternatives || []).map((x) => x.text)].join(" "),
  );
}

function scoreRule(rule: TopicRule, text: string) {
  let score = 0;
  const evidence: string[] = [];
  for (const signal of rule.signals) {
    if (!signal.re.test(text)) continue;
    score += signal.weight;
    if (!evidence.includes(signal.evidence)) evidence.push(signal.evidence);
  }
  return { score, evidence };
}

function bestSubtopic(primary: string, text: string): string | null {
  const ranked = (SUBTOPICS[primary] || [])
    .filter((rule) => rule.re.test(text))
    .sort((a, b) => b.weight - a.weight);
  return ranked[0]?.label || null;
}

export function isUnclassifiedContent(name: string): boolean {
  return /nao classificado/i.test(normalizeText(name));
}

export function classifyQuestion(q: Question): QuestionClassification {
  const area = discipline(q);
  const text = questionText(q);
  const rules = RULES[area] || [];
  const scored = rules
    .map((rule) => ({ label: rule.label, ...scoreRule(rule, text) }))
    .filter((x) => x.score > 0);

  // O campo language da API é uma evidência estrutural mais forte do que texto.
  if (area === "linguagens" && q.language) {
    const existing = scored.find((x) => x.label === "Língua estrangeira");
    if (existing) {
      existing.score += 12;
      existing.evidence.unshift(`idioma ${q.language}`);
    } else {
      scored.push({ label: "Língua estrangeira", score: 12, evidence: [`idioma ${q.language}`] });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const first = scored[0];
  const second = scored[1];
  const primary = first?.label || FALLBACK[area] || (CONTENTS[area] || ["Outro"])[0] || "Outro";
  const score = first?.score || 0;
  const margin = Math.max(0, score - (second?.score || 0));
  const confidence: ClassificationConfidence =
    score >= 10 && (margin >= 3 || score >= 15) ? "alta" : score >= 5 ? "media" : "baixa";

  const tags = scored
    .filter((x) => x.score >= 3)
    .slice(0, 3)
    .map((x) => x.label);
  if (!tags.includes(primary)) tags.unshift(primary);

  const subtopic = bestSubtopic(primary, text);
  const path = [...contentPath(primary)];
  if (subtopic && path[path.length - 1] !== subtopic) path.push(subtopic);

  return {
    primary,
    tags: [...new Set(tags)].slice(0, 3),
    path,
    subtopic,
    confidence,
    score,
    margin,
    evidence: first?.evidence.slice(0, 4) || [],
  };
}

export function classifyContent(q: Question): string {
  return classifyQuestion(q).primary;
}

// Mantém a API usada pelo restante do app, agora com tags derivadas do ranking.
export function finalTagRules(q: Question): string[] {
  return classifyQuestion(q).tags;
}

export { contentAllLabels };
