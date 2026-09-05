// Classificação automática de conteúdo (portada do v6).
import { CONTENTS, contentAllLabels } from "./constants";
import { normalizeText } from "../format";
import type { Question } from "./types";

export function discipline(q: Question): string {
  if (typeof q.discipline === "string") return q.discipline;
  return q.discipline?.value || q.discipline?.label || "";
}

export function questionKey(q: Question): string {
  return `${q.year}-${q.index}-${q.language || "pt"}-${discipline(q)}`;
}

const RULES: Record<string, [string, RegExp][]> = {
  matematica: [
    ["Porcentagem e juros", /porcent|juros|desconto|acrescimo|taxa percentual/],
    ["Probabilidade", /probabil|chance|sorteio|aleatori/],
    ["Estatística", /media |mediana|moda|desvio|frequencia|amostra|histograma/],
    ["Combinatória", /combin|permut|arranjo|possibilidades/],
    ["Trigonometria", /seno|cosseno|tangente|angulo|trigonom/],
    ["Geometria espacial", /volume|cilindro|cone|esfera|prisma|cubo|paralelepip/],
    ["Geometria plana", /area|perimetro|triangulo|circulo|circunferencia|poligono|pitagor/],
    ["Funções", /funcao|grafico|equacao|exponencial|logarit|quadratica|afim/],
    ["Sequências", /progressao|sequencia|termo geral|pa |pg /],
    ["Razão e proporcionalidade", /proporc|razao|regra de tres|escala|velocidade media/],
    ["Leitura de gráficos", /grafico|tabela|eixo|variacao/],
  ],
  "ciencias-natureza": [
    ["Física • Eletricidade", /corrente|tensao|resistencia|circuit|potencia eletr|energia eletr|transformador/],
    ["Física • Mecânica", /forca|velocidade|aceleracao|movimento|trabalho mecan|energia cinet|energia potencial|newton/],
    ["Física • Termologia", /temperatura|calor|termic|dilatacao|pressao|gas ideal/],
    ["Física • Óptica e ondas", /onda|frequencia|comprimento de onda|som|luz|espelho|lente|refracao|reflexao/],
    ["Química • Estequiometria", /mol|estequiometr|massa molar|reacao quim|balanceamento/],
    ["Química • Soluções e pH", /ph|solucao|concentracao|acido|base|solubil/],
    ["Química • Eletroquímica", /pilha|eletrolise|oxidacao|reducao|eletrodo/],
    ["Química • Orgânica", /hidrocarbon|alcool|ester|polimero|organica|carbono/],
    ["Biologia • Ecologia", /ecossistema|cadeia alimentar|populacao|bioma|impacto ambiental|biodivers/],
    ["Biologia • Genética", /gene|dna|rna|hereditar|alelo|cromossom|genetic/],
    ["Biologia • Fisiologia", /hormon|sangue|respiracao|digest|sistema nervoso|rim|coracao/],
    ["Biologia • Evolução", /evolucao|selecao natural|adaptacao|especie|ancestral/],
    ["Biologia • Citologia e metabolismo", /celula|mitocond|ribossom|membrana|fotossint|respiracao celular|atp/],
  ],
  "ciencias-humanas": [
    ["História do Brasil", /brasil colonia|imperio|republica|escrav|ditadura|vargas|independencia do brasil/],
    ["História Geral", /revolucao francesa|revolucao industrial|guerra fria|idade media|imperialismo|nazismo|fascismo/],
    ["Geografia • Urbanização", /cidade|urbani|metropole|segregacao|mobilidade urbana/],
    ["Geografia • Clima e ambiente", /clima|chuva|vegetacao|desmatamento|aquecimento|meio ambiente|solo/],
    ["Geografia • Geopolítica", /fronteira|globalizacao|geopolit|migracao|territorio|bloco economico/],
    ["Geografia • Cartografia", /mapa|escala|latitude|longitude|projecao cartograf/],
    ["Sociologia", /sociedade|classe social|desigualdade|movimento social|socializacao|cultura/],
    ["Filosofia", /etica|filosof|conhecimento|moral|politica|razao|epistem/],
    ["Trabalho e cidadania", /trabalho|cidadania|direitos|democracia|participacao politica/],
  ],
  linguagens: [
    ["Língua estrangeira", /english|spanish|ingles|espanhol/],
    ["Literatura", /poema|romance|narrador|literatura|modernismo|personagem/],
    ["Gramática em contexto", /conectivo|coesao|sintaxe|pontuacao|pronome|concordancia|semantica/],
    ["Argumentação e gêneros", /argument|tese|artigo|editorial|publicidade|campanha|genero textual/],
    ["Artes e cultura", /arte|pintura|musica|teatro|danca|cultura/],
    ["Variação linguística", /variacao linguistica|norma padrao|dialeto|fala|registro/],
    ["Tecnologia e mídia", /internet|rede social|midia|tecnologia|digital/],
    ["Interpretação textual", /.*/],
  ],
};

function questionText(q: Question): string {
  return normalizeText(
    [q.context, q.alternativesIntroduction, ...(q.alternatives || []).map((x) => x.text)].join(" "),
  );
}

export function classifyContent(q: Question): string {
  const area = discipline(q);
  const t = questionText(q);
  for (const [label, re] of RULES[area] || []) if (re.test(t)) return label;
  return (CONTENTS[area] || ["Outro"])[0];
}

// Regras multi-tag do "beta final": até 3 conteúdos por questão.
export function finalTagRules(q: Question): string[] {
  const t = questionText(q);
  const out = [classifyContent(q)];
  const add = (x: string) => {
    if (x && !out.includes(x)) out.push(x);
  };
  const area = discipline(q);
  if (area === "matematica") {
    if (/grafico|tabela|eixo|histograma/.test(t)) add("Leitura de gráficos");
    if (/porcent|desconto|juros|taxa/.test(t)) add("Porcentagem e juros");
    if (/escala|proporc|razao|regra de tres/.test(t)) add("Razão e proporcionalidade");
    if (/probabil|chance|sorteio|aleatori/.test(t)) add("Probabilidade");
    if (/media |mediana|moda|frequencia|amostra/.test(t)) add("Estatística");
    if (/seno|cosseno|tangente|trigonom/.test(t)) add("Trigonometria");
    if (/triangulo|circulo|circunferencia|perimetro|area de/.test(t)) add("Geometria plana");
    if (/volume|cilindro|cone|esfera|prisma|cubo/.test(t)) add("Geometria espacial");
    if (/funcao|equacao|exponencial|quadratic|afim|logarit/.test(t)) add("Funções");
  } else if (area === "ciencias-natureza") {
    if (/circuit|corrente|tensao|resistencia|eletric/.test(t)) add("Física • Eletricidade");
    if (/forca|aceleracao|movimento|newton|energia cinet|energia potencial/.test(t)) add("Física • Mecânica");
    if (/onda|som|luz|espelho|lente|refracao|frequencia/.test(t)) add("Física • Óptica e ondas");
    if (/calor|temperatura|termic|gas ideal|dilatacao/.test(t)) add("Física • Termologia");
    if (/mol|estequiometr|massa molar|balanceamento/.test(t)) add("Química • Estequiometria");
    if (/ph|acido|base|solucao|concentracao|solubil/.test(t)) add("Química • Soluções e pH");
    if (/pilha|eletrolise|oxidacao|reducao/.test(t)) add("Química • Eletroquímica");
    if (/dna|rna|gene|alelo|cromossom|hereditar/.test(t)) add("Biologia • Genética");
    if (/ecossistema|cadeia alimentar|bioma|populacao|biodivers/.test(t)) add("Biologia • Ecologia");
  } else if (area === "ciencias-humanas") {
    if (/mapa|escala cartograf|latitude|longitude|projecao/.test(t)) add("Geografia • Cartografia");
    if (/cidade|urbaniza|metropole|segregacao urbana/.test(t)) add("Geografia • Urbanização");
    if (/clima|chuva|desmatamento|aquecimento|vegetacao/.test(t)) add("Geografia • Clima e ambiente");
    if (/globalizacao|geopolit|fronteira|bloco economico|migracao/.test(t)) add("Geografia • Geopolítica");
    if (/cidadania|direitos|trabalho|democracia/.test(t)) add("Trabalho e cidadania");
    if (/filosof|etica|moral|epistem|razao/.test(t)) add("Filosofia");
    if (/classe social|desigualdade|movimento social|socializacao/.test(t)) add("Sociologia");
  } else if (area === "linguagens") {
    if (/poema|romance|literatura|modernismo|narrador/.test(t)) add("Literatura");
    if (/publicidade|campanha|argument|tese|editorial/.test(t)) add("Argumentação e gêneros");
    if (/internet|rede social|midia|digital|tecnologia/.test(t)) add("Tecnologia e mídia");
    if (/variacao linguistica|norma padrao|dialeto|registro/.test(t)) add("Variação linguística");
    if (/coesao|sintaxe|concordancia|pronome|pontuacao|semantica/.test(t)) add("Gramática em contexto");
  }
  return out.slice(0, 3);
}

export { contentAllLabels };
