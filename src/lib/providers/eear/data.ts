import type { ReferenceAnswerKeyRaw } from "../vestibular-reference";

export interface CompactEearVariant {
  id: string;
  label: string;
  answers: string;
  examUrl: string;
  answerKeyUrl: string;
}

export interface CompactEearSpec {
  id: string;
  year: number;
  label: string;
  kind: "cfs" | "eags";
  specialty?: string | null;
  total: 96 | 100;
  canonical: CompactEearVariant & {
    examSha256: string;
    examBytes: number;
    keySha256: string;
    keyBytes: number;
  };
  variants: CompactEearVariant[];
}

const ARCHIVE_PAGE =
  "https://ingresso.eear.fab.mil.br/SOO/home/provas_anteriores.php?sigla_conc=%25";
const PARSER_VERSION = "eear-corpus-reference@1.0.0";

function decodeAnswers(sequence: string, total: number) {
  if (sequence.length !== total) {
    throw new Error(`sequência EEAR inválida: esperado ${total}, recebido ${sequence.length}`);
  }
  const answers: Record<string, string> = {};
  const annulled: number[] = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const token = sequence[index];
    const number = index + 1;
    if (token === "X") {
      annulled.push(number);
    } else {
      answers[String(number)] = token;
    }
  }
  return { answers, annulled };
}

function specialtyId(spec: CompactEearSpec): string {
  return spec.id
    .replace(/^\d{4}-eags(?:-\d{4})?-/, "")
    .replace(/[^a-z0-9-]/g, "-");
}

function subjectsFor(spec: CompactEearSpec): ReferenceAnswerKeyRaw["subjects"] {
  if (spec.kind === "cfs") {
    return [
      { id: "portuguese", label: "Português", area: "linguagens", range: [1, 24] },
      { id: "mathematics", label: "Matemática", area: "matematica", range: [25, 48] },
      { id: "physics", label: "Física", area: "ciencias-natureza", range: [49, 72] },
      { id: "english", label: "Inglês", area: "linguagens", range: [73, 96] },
    ];
  }
  return [
    { id: "portuguese", label: "Português", area: "linguagens", range: [1, 40] },
    {
      id: specialtyId(spec),
      label: spec.specialty ?? "Conhecimentos específicos",
      area: "conhecimentos-especificos",
      range: [41, 100],
    },
  ];
}

export function buildEearRawCatalog(specs: CompactEearSpec[]): Record<string, ReferenceAnswerKeyRaw> {
  return Object.fromEntries(
    specs.map((spec) => {
      const canonical = decodeAnswers(spec.canonical.answers, spec.total);
      const variantAnswerKeys = Object.fromEntries(
        spec.variants.map((variant) => [variant.id, decodeAnswers(variant.answers, spec.total)]),
      );
      const variants = [spec.canonical, ...spec.variants].map((variant) => ({
        id: variant.id,
        label: variant.label,
        examUrl: variant.examUrl,
        answerKeyUrl: variant.answerKeyUrl,
      }));

      const raw: ReferenceAnswerKeyRaw = {
        edition: spec.id,
        year: spec.year,
        label: spec.label,
        phase: "single",
        total: spec.total,
        canonicalVariant: spec.canonical.id,
        variantRelation: "unknown",
        revision: "final",
        answers: canonical.answers,
        annulled: canonical.annulled,
        optionIds: ["A", "B", "C", "D"],
        officialDocument: false,
        variantAnswerKeys: spec.variants.length ? variantAnswerKeys : undefined,
        variants,
        answerKeyUrl: spec.canonical.answerKeyUrl,
        examUrl: spec.canonical.examUrl,
        archivePage: ARCHIVE_PAGE,
        subjects: subjectsFor(spec),
        contentMode: "reference-only",
        rightsStatus: "permission-required",
        validationLevel: "reviewed",
        validationEvidence: [
          "O PDF do gabarito se identifica como Gabarito Oficial da EEAR.",
          "A página do gabarito contém cobertura completa e contígua da edição.",
          "O corpus conferiu tamanho e SHA-256 dos bytes espelhados antes da normalização.",
          "Códigos da mesma aplicação são preservados como variantes e não inflacionam a contagem de edições.",
        ],
        retrieval: {
          originalUrl: spec.canonical.answerKeyUrl,
          effectiveSourceUrl: spec.canonical.answerKeyUrl,
          sourceType: "pdf-reference",
          fetchedAt: "2026-09-12",
          sha256: spec.canonical.keySha256,
          bytes: spec.canonical.keyBytes,
          parserVersion: PARSER_VERSION,
          revision: "final",
          final: true,
        },
        parserVersion: PARSER_VERSION,
      };
      return [spec.id, raw];
    }),
  );
}
