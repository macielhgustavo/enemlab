export type AcademicConfidence = "alta" | "media" | "baixa";

export interface ReviewedAcademicMetadata {
  providerId: string;
  year: number;
  phase: string;
  number: number;
  area: string;
  discipline: string;
  topic: string;
  subtopic: string | null;
  difficulty?: "facil" | "media" | "dificil";
  confidence: AcademicConfidence;
  reviewedAt: string;
  sourceDocumentSha256: string;
  evidence: string;
}

interface AcademicRange {
  from: number;
  to: number;
  area: string;
  discipline: string;
  topic: string;
  confidence: AcademicConfidence;
}

/**
 * Mapa factual da organização acadêmica da primeira fase UNESP 2026.
 *
 * Não contém enunciados nem alternativas. O objetivo é permitir que uma
 * questão reference-only participe de domínio/plano/adaptativo sem inventar
 * texto protegido. A divisão foi revisada no caderno da versão 1; quando a
 * fronteira é interdisciplinar, usamos um tópico amplo em vez de simular uma
 * precisão que o documento não fornece.
 */
const RANGES: AcademicRange[] = [
  { from: 1, to: 5, area: "linguagens", discipline: "Língua Portuguesa", topic: "Leitura, linguagem e literatura", confidence: "alta" },
  { from: 6, to: 11, area: "linguagens", discipline: "Língua Portuguesa", topic: "Literatura e poesia", confidence: "alta" },
  { from: 12, to: 20, area: "linguagens", discipline: "Língua Portuguesa", topic: "Leitura, literatura e artes", confidence: "media" },
  { from: 21, to: 30, area: "linguagens", discipline: "Língua Inglesa", topic: "Língua inglesa e interpretação", confidence: "alta" },
  { from: 31, to: 40, area: "ciencias-humanas", discipline: "História", topic: "História", confidence: "alta" },
  { from: 41, to: 54, area: "ciencias-humanas", discipline: "Geografia", topic: "Geografia e sociedade", confidence: "media" },
  { from: 55, to: 60, area: "ciencias-humanas", discipline: "Filosofia e Sociologia", topic: "Filosofia e sociologia", confidence: "alta" },
  { from: 61, to: 68, area: "ciencias-natureza", discipline: "Biologia", topic: "Biologia", confidence: "alta" },
  { from: 69, to: 75, area: "ciencias-natureza", discipline: "Química", topic: "Química", confidence: "alta" },
  { from: 76, to: 82, area: "ciencias-natureza", discipline: "Física", topic: "Física", confidence: "alta" },
  { from: 83, to: 90, area: "matematica", discipline: "Matemática", topic: "Matemática", confidence: "alta" },
];

const SUBTOPICS: Partial<Record<number, string>> = {
  31: "Antiguidade e religião",
  32: "Idade Média",
  40: "Trabalho e gênero",
  48: "Território e redes",
  50: "Tectônica de placas",
  51: "Solos",
  55: "Mito e filosofia",
  56: "Filosofia da ciência",
  60: "Tecnologia e desigualdade",
  61: "Genética molecular",
  64: "Ecologia",
  65: "Genética",
  66: "Embriologia",
  68: "Fisiologia humana",
  69: "Quantidade de matéria",
  71: "Estequiometria e eletroquímica",
  73: "Oxirredução e termoquímica",
  75: "Química orgânica",
  76: "Oscilações",
  77: "Movimento circular",
  79: "Óptica geométrica",
  81: "Eletrostática",
  82: "Eletricidade e termologia",
  83: "Porcentagem e média",
  84: "Função afim",
  86: "Função quadrática",
  87: "Geometria plana",
  88: "Geometria espacial",
  90: "Progressões geométricas",
};

const DOCUMENT_SHA256 = "fda4e93aa4b1db96dd07fca3905fd7a254262087da5ddfd44b0f26f742a8a8d0";
const REVIEWED_AT = "2026-09-13T00:00:00-03:00";

export function unesp2026AcademicMetadata(number: number): ReviewedAcademicMetadata | null {
  if (!Number.isInteger(number) || number < 1 || number > 90) return null;
  const range = RANGES.find((candidate) => number >= candidate.from && number <= candidate.to);
  if (!range) return null;
  return {
    providerId: "unesp",
    year: 2026,
    phase: "first",
    number,
    area: range.area,
    discipline: range.discipline,
    topic: range.topic,
    subtopic: SUBTOPICS[number] ?? null,
    confidence: range.confidence,
    reviewedAt: REVIEWED_AT,
    sourceDocumentSha256: DOCUMENT_SHA256,
    evidence: "organização acadêmica revisada no caderno UNESP 2026, versão 1",
  };
}

export function unesp2026AcademicCount(): number {
  return Array.from({ length: 90 }, (_, index) => unesp2026AcademicMetadata(index + 1))
    .filter((entry): entry is ReviewedAcademicMetadata => entry !== null).length;
}
