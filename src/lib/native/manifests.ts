export interface PrivateNativeTargetManifest {
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
  storage: "private-browser" | "private-supabase" | "repository";
  reason: string;
}

/**
 * Primeiro alvo de conteúdo nativo privado. Os hashes garantem que o conteúdo
 * importado por vocês corresponde exatamente aos bytes revisados pelo provider.
 * O GitHub público mantém somente código + proveniência; páginas e recortes
 * publicados vivem no bucket privado do Supabase e exigem sessão autorizada.
 */
export const UNESP_2026_LOCAL_NATIVE_TARGET: PrivateNativeTargetManifest = {
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
  storage: "private-supabase",
  reason:
    "O Studium é usado de forma privada; páginas e recortes ficam no bucket privado native-content, enquanto o GitHub público mantém identidade, gabarito e proveniência.",
};

// Alias temporário para não quebrar imports do Sprint 1.
export type LocalNativeTargetManifest = PrivateNativeTargetManifest;
