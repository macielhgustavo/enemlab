/**
 * Página física do PDF VUNESP 2026 em que cada questão começa.
 *
 * Derivada dos marcadores `QUESTÃO NN` do caderno revisado e fingerprintado
 * pelo provider. É metadado de navegação, não reprodução do enunciado.
 */
const UNESP_2026_PAGES = [
  3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7, 8, 8, 9,
  9, 9, 10, 10, 10, 10, 10, 11, 11, 11, 12, 12, 13, 13, 13, 14, 14, 15, 15, 16,
  16, 17, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25,
  26, 26, 26, 27, 27, 27, 28, 28, 29, 29, 29, 30, 30, 30, 31, 31, 32, 32, 33, 33,
  34, 34, 35, 35, 36, 36, 37, 37, 38, 38,
] as const;

export function unespSourcePage(year: number, questionNumber: number): number | null {
  if (year !== 2026 || questionNumber < 1 || questionNumber > UNESP_2026_PAGES.length) return null;
  return UNESP_2026_PAGES[questionNumber - 1] ?? null;
}

export function unespDocumentUrlAtPage(url: string, page: number): string {
  const base = url.split("#", 1)[0];
  return `${base}#page=${page}&zoom=page-width`;
}

export const UNESP_2026_PAGE_COUNT = UNESP_2026_PAGES.length;
