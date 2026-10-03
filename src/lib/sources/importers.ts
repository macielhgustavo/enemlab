// Importadores e procedência das fontes.
import { itaYears, itaFirstPhaseUrl, itaSecondPhaseUrls } from "../providers/ita";
import { imeYears, imeExamUrl, imeAnswerKeyUrl, imeEditionOfYear } from "../providers/ime";
import { fuvestYears, fuvestExamUrl, fuvestSecondPhaseUrls } from "../providers/fuvest";
import { afaAnswerKey, afaYears } from "../providers/afa";
import { epcarAnswerKey, epcarYears } from "../providers/epcar";
import { espcexExamOfficial, espcexExamUrl, espcexYears } from "../providers/espcex";
import { esaExamUrl, esaYears } from "../providers/esa";
import { unicampExamUrl, unicampYears } from "../providers/unicamp";
import { uelExamUrl, uelYears } from "../providers/uel";
import { pucSpExamUrl, pucSpYears } from "../providers/puc-sp";
import { udescEditions, udescExamUrl, udescYears } from "../providers/udesc";
import { acafeEditions, acafeExamUrl, acafeYears } from "../providers/acafe";
import { examYears } from "../domain/constants";
import type { ExamImporter, ExamSourceDefinition, Provenance } from "./types";
import {
  acafeSource,
  afaSource,
  enemSource,
  epcarSource,
  esaSource,
  espcexSource,
  fuvestSource,
  imeSource,
  itaSource,
  pucSpSource,
  udescSource,
  uelSource,
  unicampSource,
} from "./definitions";

function provenance(src: ExamSourceDefinition, documentUrl: string, page?: number): Provenance {
  return {
    providerId: src.providerId,
    sourceId: src.id,
    institution: src.institution,
    official: src.rightsStatus !== "unknown",
    documentUrl,
    page,
    parserVersion: src.parserVersion,
    lastVerifiedAt: src.lastVerifiedAt,
  };
}

export const itaImporter: ExamImporter = {
  sourceId: itaSource.id,
  availableYears: () => itaYears(),
  provenanceFor(year, phase = "first", page) {
    // A 2ª fase é dividida por matéria; sem matéria, aponta o arquivo do ano.
    const url =
      phase === "second"
        ? (itaSecondPhaseUrls(year)[0]?.url ?? itaFirstPhaseUrl(year))
        : itaFirstPhaseUrl(year);
    return provenance(itaSource, url, page);
  },
};

export const enemImporter: ExamImporter = {
  sourceId: enemSource.id,
  availableYears: () => examYears(),
  provenanceFor(year) {
    return provenance(enemSource, `${enemSource.archiveUrl}/v1/exams/${year}/questions`);
  },
};

export const imeImporter: ExamImporter = {
  sourceId: imeSource.id,
  availableYears: () => imeYears(),
  provenanceFor(year, phase = "first", page) {
    const edicao = imeEditionOfYear(year);
    // Sem edição conhecida, a procedência aponta o arquivo da instituição —
    // nunca uma URL montada por padrão, que daria 404 ou o documento errado.
    const url =
      (edicao && (phase === "first" ? imeExamUrl(edicao) : imeAnswerKeyUrl(edicao))) ??
      imeSource.archiveUrl;
    return provenance(imeSource, url, page);
  },
};

export const fuvestImporter: ExamImporter = {
  sourceId: fuvestSource.id,
  availableYears: () => fuvestYears(),
  provenanceFor(year, phase = "first", page) {
    const url =
      (phase === "first" ? fuvestExamUrl(year) : fuvestSecondPhaseUrls(year)[0]) ??
      fuvestSource.archiveUrl;
    return provenance(fuvestSource, url, page);
  },
};

export const afaImporter: ExamImporter = {
  sourceId: afaSource.id,
  availableYears: () => afaYears(),
  provenanceFor(year, phase = "first", page) {
    const key = afaAnswerKey(year);
    const url = phase === "first" ? key?.examUrl ?? key?.answerKeyUrl : afaSource.archiveUrl;
    return provenance(afaSource, url ?? afaSource.archiveUrl, page);
  },
};

export const epcarImporter: ExamImporter = {
  sourceId: epcarSource.id,
  availableYears: () => epcarYears(),
  provenanceFor(year, phase = "first", page) {
    const key = epcarAnswerKey(year);
    const url = phase === "first" ? key?.examUrl ?? key?.answerKeyUrl : epcarSource.archiveUrl;
    return provenance(epcarSource, url ?? epcarSource.archiveUrl, page);
  },
};

export const espcexImporter: ExamImporter = {
  sourceId: espcexSource.id,
  availableYears: () => espcexYears(),
  provenanceFor(year, phase = "day1", page) {
    const selectedPhase = phase === "day2" ? "day2" : "day1";
    const url = espcexExamUrl(year, selectedPhase) ?? espcexSource.archiveUrl;
    return {
      ...provenance(espcexSource, url, page),
      official: espcexExamOfficial(year, selectedPhase),
    };
  },
};

export const esaImporter: ExamImporter = {
  sourceId: esaSource.id,
  availableYears: () => esaYears(),
  provenanceFor(year, phase = "single", page) {
    const url = phase === "single" ? esaExamUrl(year) : null;
    return { ...provenance(esaSource, url ?? esaSource.archiveUrl, page), official: false };
  },
};

export const unicampImporter: ExamImporter = {
  sourceId: unicampSource.id,
  availableYears: () => unicampYears(),
  provenanceFor(year, phase = "first", page) {
    const url = phase === "first" ? unicampExamUrl(year) : unicampSource.archiveUrl;
    return provenance(unicampSource, url ?? unicampSource.archiveUrl, page);
  },
};

export const uelImporter: ExamImporter = {
  sourceId: uelSource.id,
  availableYears: () => uelYears(),
  provenanceFor(year, phase = "first", page) {
    const url = phase === "first" ? uelExamUrl(year) : uelSource.archiveUrl;
    return provenance(uelSource, url ?? uelSource.archiveUrl, page);
  },
};

export const pucSpImporter: ExamImporter = {
  sourceId: pucSpSource.id,
  availableYears: () => pucSpYears(),
  provenanceFor(year, phase = "single", page) {
    const url = phase === "single" ? pucSpExamUrl(year) : pucSpSource.archiveUrl;
    return provenance(pucSpSource, url ?? pucSpSource.archiveUrl, page);
  },
};

export const udescImporter: ExamImporter = {
  sourceId: udescSource.id,
  availableYears: () => udescYears(),
  provenanceFor(year, phase = "morning", page) {
    const edition = udescEditions().find((candidate) => candidate.year === year);
    const session = phase === "afternoon" ? "afternoon" : "morning";
    const url = edition ? udescExamUrl(edition.id, session) : null;
    return provenance(udescSource, url ?? udescSource.archiveUrl, page);
  },
};

export const acafeImporter: ExamImporter = {
  sourceId: acafeSource.id,
  availableYears: () => acafeYears(),
  provenanceFor(year, phase = "single", page) {
    const edition = acafeEditions().find((candidate) => candidate.year === year);
    const url = phase === "single" && edition ? acafeExamUrl(edition.id) : null;
    return provenance(acafeSource, url ?? acafeSource.archiveUrl, page);
  },
};

export function importerForProvider(providerId: string): ExamImporter | null {
  if (providerId === "ita") return itaImporter;
  if (providerId === "enem") return enemImporter;
  if (providerId === "ime") return imeImporter;
  if (providerId === "fuvest") return fuvestImporter;
  if (providerId === "afa") return afaImporter;
  if (providerId === "epcar") return epcarImporter;
  if (providerId === "espcex") return espcexImporter;
  if (providerId === "esa") return esaImporter;
  if (providerId === "unicamp") return unicampImporter;
  if (providerId === "uel") return uelImporter;
  if (providerId === "puc-sp") return pucSpImporter;
  if (providerId === "udesc") return udescImporter;
  if (providerId === "acafe") return acafeImporter;
  return null;
}
