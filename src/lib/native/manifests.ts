export interface LocalNativeTargetManifest {
  providerId: string;
  year: number;
  phase: string;
  expectedQuestions: number;
  optionIds: string[];
  source: {
    documentUrl: string;
    sha256: string;
    bytes: number;
    authority: "official" | "mirror";
  };
  answerKey: {
    documentUrl: string;
    sha256: string;
    bytes: number;
    authority: "official" | "mirror";
    canonicalOfficialUrl?: string;
  };
  publication: "local-only" | "allowed";
  reason: string;
}

/**
 * O alvo do primeiro sprint nativo. Os hashes fixam os bytes revisados, mas
 * o texto não é versionado: a VUNESP mantém direitos reservados e a fonte de
 * bytes usada pela pipeline é um espelho público.
 */
export const UNESP_2026_LOCAL_NATIVE_TARGET: LocalNativeTargetManifest = {
  providerId: "unesp",
  year: 2026,
  phase: "first",
  expectedQuestions: 90,
  optionIds: ["A", "B", "C", "D", "E"],
  source: {
    documentUrl:
      "https://s3.glbimg.com/v1/AUTH_595b237b135e4899b878697d214a26e9/unesp_2026_resolucao_primeira_fase/PROVA_VERSAO_UM_UNESP_2026.pdf",
    sha256: "fda4e93aa4b1db96dd07fca3905fd7a254262087da5ddfd44b0f26f742a8a8d0",
    bytes: 4018639,
    authority: "mirror",
  },
  answerKey: {
    documentUrl:
      "https://www.curso-objetivo.br/vestibular/resolucao-comentada/unesp/2026/1fase/UNESP2026_1fase_gabarito.pdf",
    sha256: "b1240abe2985d473a62513e33df7b083010e40d633df0e6d6a95ab7fad214717",
    bytes: 317314,
    authority: "mirror",
    canonicalOfficialUrl:
      "https://documento.vunesp.com.br/documento/stream/NzQ2NDIxNg%3D%3D",
  },
  publication: "local-only",
  reason:
    "Conteúdo textual pode ser usado em overlay local após revisão, mas não é redistribuído pelo repositório sem permissão explícita.",
};
