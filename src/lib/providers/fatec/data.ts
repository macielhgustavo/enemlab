import type { ReferenceAnswerKeyRaw } from "../vestibular-reference";

interface FatecSpec {
  id: string;
  year: number;
  label: string;
  total: number;
  answers: string;
  examUrl: string;
  answerKeyUrl: string;
  revision: "final" | "rectified";
}

const ARCHIVE_PAGE = "https://vestibular.fatec.sp.gov.br/provas-gabaritos/";
const PARSER_VERSION = "fatec-official-reference@1.0.0";

const SPECS: FatecSpec[] = [
  {
    id: "2022.2",
    year: 2022,
    label: "FATEC 2022 - 2º semestre",
    total: 54,
    answers: "BCDBBCCBECCCAEDABBCBECABBDEBBEECBCEEDAABCCDEEEDABCCEDD",
    examUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202228712/Prova.pdf?v=2.1",
    answerKeyUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202228712/Gabarito.pdf?v=2.1",
    revision: "final",
  },
  {
    id: "2023.1",
    year: 2023,
    label: "FATEC 2023 - 1º semestre",
    total: 54,
    answers: "DEBADACDCEDADCCBDCBCADBDBDEEADEBCBEEACADDBECDCCBBCDBBC",
    examUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202315287/Prova.pdf?v=2.1",
    answerKeyUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202315287/Gabarito.pdf?v=2.1",
    revision: "final",
  },
  {
    id: "2023.2",
    year: 2023,
    label: "FATEC 2023 - 2º semestre",
    total: 54,
    answers: "CDBABDEAEEDDCECAEBDEECBBECCEEBADECDEAAXBACABCEBBDDAEBE",
    examUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202327519/Prova.pdf?v=2.1",
    answerKeyUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202327519/Gabarito.pdf?v=2.1",
    revision: "rectified",
  },
  {
    id: "2024.1",
    year: 2024,
    label: "FATEC 2024 - 1º semestre",
    total: 54,
    answers: "DCCADCDDACAEABEADDEACEEDEDBADEAEDCBDDCCAEDDBDDAEAEDEBC",
    examUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202415903/Prova.pdf?v=2.1",
    answerKeyUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202415903/Gabarito.pdf?v=2.1",
    revision: "final",
  },
  {
    id: "2024.2",
    year: 2024,
    label: "FATEC 2024 - 2º semestre",
    total: 54,
    answers: "BDEEDCEDDAEBDBACDDEDECCDDEADEADDEEDCADAECBDCCECBAEDACE",
    examUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202426517/Prova.pdf?v=2.1",
    answerKeyUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202426517/Gabarito_retificado.pdf?v=2.1",
    revision: "rectified",
  },
  {
    id: "2025.2",
    year: 2025,
    label: "FATEC 2025 - 2º semestre",
    total: 64,
    answers: "CEEDDDECCEAADCAACDCECECBDCEADEBBADADEEABBDBEBDCCECDDEBEDAEBDAECE",
    examUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202528719/Prova.pdf?v=2.1",
    answerKeyUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202528719/Gabarito.pdf?v=2.1",
    revision: "final",
  },
  {
    id: "2026.1",
    year: 2026,
    label: "FATEC 2026 - 1º semestre",
    total: 60,
    answers: "CABCECAAEBEDCBEEBBEDBACECABDEDDABCCAEDEEBCDCDADCAEEEAAADBDAB",
    examUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202619102/Prova.pdf?v=2.1",
    answerKeyUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202619102/Gabarito.pdf?v=2.1",
    revision: "final",
  },
  {
    id: "2026.2",
    year: 2026,
    label: "FATEC 2026 - 2º semestre",
    total: 60,
    answers: "DCBEECDBDAEBBADEBDCADDBBCBCBCDDEACEADCBDEBCDADDBCAEEACACBCBD",
    examUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202626241/Prova.pdf?v=2.1",
    answerKeyUrl: "https://fatweb.s3.amazonaws.com/vestibularfatec/gabarito/202626241/Gabarito.pdf?v=2.1",
    revision: "final",
  },
];

function decode(sequence: string, total: number) {
  if (sequence.length !== total) {
    throw new Error(`FATEC: sequência inválida, esperado ${total}, recebido ${sequence.length}`);
  }
  const answers: Record<string, string> = {};
  const annulled: number[] = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const number = index + 1;
    const token = sequence[index];
    if (token === "X") annulled.push(number);
    else answers[String(number)] = token;
  }
  return { answers, annulled };
}

export function buildFatecRawCatalog(): Record<string, ReferenceAnswerKeyRaw> {
  return Object.fromEntries(SPECS.map((spec) => {
    const decoded = decode(spec.answers, spec.total);
    const raw: ReferenceAnswerKeyRaw = {
      edition: spec.id,
      year: spec.year,
      label: spec.label,
      phase: "single",
      total: spec.total,
      canonicalVariant: "unica",
      variantRelation: "unknown",
      revision: spec.revision,
      answers: decoded.answers,
      annulled: decoded.annulled,
      optionIds: ["A", "B", "C", "D", "E"],
      officialDocument: true,
      variants: [{
        id: "unica",
        label: "Prova única",
        examUrl: spec.examUrl,
        answerKeyUrl: spec.answerKeyUrl,
      }],
      answerKeyUrl: spec.answerKeyUrl,
      examUrl: spec.examUrl,
      archivePage: ARCHIVE_PAGE,
      subjects: [{
        id: "conhecimentos-gerais",
        label: "Conhecimentos gerais",
        area: "geral",
        range: [1, spec.total],
      }],
      contentMode: "reference-only",
      rightsStatus: "official-reference",
      validationLevel: "reviewed",
      validationEvidence: [
        "Prova e gabarito publicados no arquivo oficial do Vestibular FATEC.",
        "O caderno declara prova objetiva de alternativa única A-E.",
        "Cobertura do gabarito final/retificado conferida integralmente.",
        "Fingerprint local pendente; por isso a edição não é marcada como verified.",
      ],
      retrieval: {
        originalUrl: spec.answerKeyUrl,
        effectiveSourceUrl: spec.answerKeyUrl,
        sourceType: "pdf-reference",
        fetchedAt: "2026-09-12",
        sha256: null,
        bytes: null,
        parserVersion: PARSER_VERSION,
        revision: spec.revision,
        final: true,
      },
      parserVersion: PARSER_VERSION,
    };
    return [spec.id, raw];
  }));
}
