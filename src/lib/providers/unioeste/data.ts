import type { ReferenceAnswerKeyRaw, ReferenceSubjectRaw } from "../vestibular-reference";

interface UnioesteYearSpec {
  year: number;
  morning: string;
  afternoon: string;
  morningExamUrl: string;
  afternoonExamUrl: string;
  answerKeyUrl: string;
}

const ARCHIVE_PAGE = "https://www.unioeste.br/portal/vestibular/anteriores/82161-cadernos-de-prova";
const PARSER_VERSION = "unioeste-reference@1.0.0";

const SPECS: UnioesteYearSpec[] = [
  { year: 2026, morning: "CEBDACACEBABDBDCEABBXXDCCXC", afternoon: "CDABACBCABBDDACDDCDBBACBCABBBCCEDEBCCDCBBBDBECCBCCACBCEDCECDECDCAEBDACCE", morningExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2026/cadernos/padrao-manha-ingles.pdf", afternoonExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2026/cadernos/padrao-tarde.pdf", answerKeyUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2026/gabaritos/Gabarito-Definitivo-Padrao.pdf" },
  { year: 2025, morning: "ADXCEAXDDCADCCEBECXEXCEBXDA", afternoon: "CDCDEABEEXBACCBBBDDCEDACDACBEDADBECABEAABCXDEADXCXEAXACAEBAECDBAAEABDXEC", morningExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2025/cadernos/padrao-manha-ingles.pdf", afternoonExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2025/cadernos/padrao-tarde.pdf", answerKeyUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2025/gabaritos/Gabarito_Definitivo-Padrao.pdf" },
  { year: 2024, morning: "DBBEEBCDECDACXBCABBCCXAADBD", afternoon: "ADCCEDBEADCADCDABBCECEACDAXCDCEBCEBDCXAAEDCBEAXECBBBAXDDACBBEAEDEXBBCDBA", morningExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2024/cadernos/padrao-manha-ingles.pdf", afternoonExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2024/cadernos/padrao-tarde.pdf", answerKeyUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2024/gabaritos/Gabarito_Definitivo-Vestibular_Padrao.pdf" },
  { year: 2023, morning: "ECACDABDECABCEADEACBE", afternoon: "DEBECBCABBDBDDCBAEDCDCDDCABBCDCEBEABCEACBEBACDBDXEDEDBCB", morningExamUrl: "https://webcon.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2023/cadernos/Manha-Ingles.pdf", afternoonExamUrl: "https://webcon.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2023/cadernos/Tarde.pdf", answerKeyUrl: "https://webcon.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2023/Gabarito_Definitivo.pdf" },
  { year: 2022, morning: "CABEXBDCCEEABDDXABBDE", afternoon: "EDACEBCBAEEECCCCEBADACDDEABCCEXDBBCEBCDAAEAEDCDCXEABEDXD", morningExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2022/provas/Ingles.pdf", afternoonExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2022/provas/Tarde.pdf", answerKeyUrl: "https://webcon.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2022/Gabarito_Definitivo.pdf" },
  { year: 2021, morning: "CDXDACBDEXABCACDDBDED", afternoon: "ABCCEADDECACEDEBADECADBDCADEXABCDAEBDDACEACDCBAEACDBXAEB", morningExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2021/Manha-Ingles.pdf", afternoonExamUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2021/Tarde.pdf", answerKeyUrl: "https://www.unioeste.br/portal/arq/files/ingresso/DCV/Vestibular/2021/Gabarito_Definitivo.pdf" },
];

function decode(sequence: string) {
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

function morningSubjects(total: number): ReferenceSubjectRaw[] {
  const block = total / 3;
  return [
    { id: "english", label: "Inglês", area: "linguagens", range: [1, block] },
    { id: "portuguese", label: "Português", area: "linguagens", range: [block + 1, block * 2] },
    { id: "literature", label: "Literatura", area: "linguagens", range: [block * 2 + 1, block * 3] },
  ];
}

function afternoonSubjects(total: number): ReferenceSubjectRaw[] {
  const block = total / 8;
  const subjects = [
    ["geography", "Geografia", "ciencias-humanas"], ["history", "História", "ciencias-humanas"],
    ["philosophy", "Filosofia", "ciencias-humanas"], ["sociology", "Sociologia", "ciencias-humanas"],
    ["biology", "Biologia", "ciencias-natureza"], ["physics", "Física", "ciencias-natureza"],
    ["mathematics", "Matemática", "matematica"], ["chemistry", "Química", "ciencias-natureza"],
  ] as const;
  return subjects.map(([id, label, area], index) => ({ id, label, area, range: [index * block + 1, (index + 1) * block] as [number, number] }));
}

function rawSession(spec: UnioesteYearSpec, phase: "morning" | "afternoon"): ReferenceAnswerKeyRaw {
  const sequence = phase === "morning" ? spec.morning : spec.afternoon;
  const examUrl = phase === "morning" ? spec.morningExamUrl : spec.afternoonExamUrl;
  const decoded = decode(sequence);
  const subjects = phase === "morning" ? morningSubjects(sequence.length) : afternoonSubjects(sequence.length);
  const canonicalVariant = phase === "morning" ? "ingles" : "unica";
  return {
    edition: String(spec.year), year: spec.year,
    label: `Vestibular UNIOESTE ${spec.year} - ${phase === "morning" ? "manhã (inglês)" : "tarde"}`,
    phase, total: sequence.length, canonicalVariant, variantRelation: "distinct", revision: "final",
    answers: decoded.answers, annulled: decoded.annulled, optionIds: ["A", "B", "C", "D", "E"], officialDocument: true,
    variants: [{ id: canonicalVariant, label: phase === "morning" ? "Inglês" : "Prova única", examUrl, answerKeyUrl: spec.answerKeyUrl }],
    answerKeyUrl: spec.answerKeyUrl, examUrl, archivePage: ARCHIVE_PAGE, subjects,
    contentMode: "reference-only", rightsStatus: "official-reference", validationLevel: "reviewed",
    validationEvidence: [
      "Caderno e gabarito definitivo publicados no arquivo oficial da UNIOESTE.",
      "O caderno declara questões objetivas com cinco alternativas e uma única resposta correta.",
      "Anuladas e alterações do gabarito definitivo foram preservadas na cobertura integral da sessão.",
      "Somente a versão de Inglês da sessão da manhã entra no runner; Espanhol permanece fora para evitar duplicidade de identidade.",
    ],
    retrieval: { originalUrl: spec.answerKeyUrl, effectiveSourceUrl: spec.answerKeyUrl, sourceType: "pdf-reference", fetchedAt: "2026-09-12", sha256: null, bytes: null, parserVersion: PARSER_VERSION, revision: "final", final: true },
    parserVersion: PARSER_VERSION,
  };
}

export function buildUnioesteRawCatalog(): Record<string, ReferenceAnswerKeyRaw> {
  return Object.fromEntries(SPECS.flatMap((spec) => [[`${spec.year}-morning`, rawSession(spec, "morning")], [`${spec.year}-afternoon`, rawSession(spec, "afternoon")]]));
}
