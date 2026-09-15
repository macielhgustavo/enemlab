import raw from "./answer-keys.generated.json";
import { buildMass2Provider, type Mass2ProviderSpec } from "../mass2-reference";
import type { ReferenceAnswerKeyRaw } from "../vestibular-reference";

export const MASS2_PROVIDER_SPECS = [
  {
    id: "ufpr",
    institution: "UFPR",
    label: "Universidade Federal do Paraná",
    shortLabel: "UFPR",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/universidade-federal-parana.htm",
  },
  {
    id: "uece",
    institution: "UECE/CEV",
    label: "Universidade Estadual do Ceará",
    shortLabel: "UECE",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-ceara.htm",
  },
  {
    id: "uerj",
    institution: "UERJ",
    label: "Universidade do Estado do Rio de Janeiro",
    shortLabel: "UERJ",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estado-rio-janeiro-1.htm",
  },
  {
    id: "cederj",
    institution: "CEDERJ/CECIERJ",
    label: "Consórcio CEDERJ",
    shortLabel: "CEDERJ",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/centro-ciencias-educacao-superior-distancia-estado-.htm",
  },
  {
    id: "puc-rio",
    institution: "PUC-Rio",
    label: "Pontifícia Universidade Católica do Rio de Janeiro",
    shortLabel: "PUC-Rio",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/pontificia-universidade-catolica-rio-janeiro.htm",
  },
  {
    id: "ufrgs",
    institution: "UFRGS",
    label: "Universidade Federal do Rio Grande do Sul",
    shortLabel: "UFRGS",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/universidade-federal-rio-grande-sul.htm",
  },
  {
    id: "unicentro",
    institution: "UNICENTRO",
    label: "Universidade Estadual do Centro-Oeste",
    shortLabel: "UNICENTRO",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-centrooeste.htm",
  },
  {
    id: "uemg",
    institution: "UEMG",
    label: "Universidade do Estado de Minas Gerais",
    shortLabel: "UEMG",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estado-minas-gerais.htm",
  },
  {
    id: "unespar",
    institution: "UNESPAR",
    label: "Universidade Estadual do Paraná",
    shortLabel: "UNESPAR",
    archiveUrl: "https://vestibular.brasilescola.uol.com.br/downloads/universidade-estadual-parana.htm",
  },
] as const satisfies readonly Mass2ProviderSpec[];

type GeneratedRoot = Record<string, Record<string, ReferenceAnswerKeyRaw>>;
const generated = raw as unknown as GeneratedRoot;

export const MASS2_BUNDLES = Object.fromEntries(
  MASS2_PROVIDER_SPECS.map((spec) => [
    spec.id,
    buildMass2Provider(spec, generated[spec.id] ?? {}),
  ]),
) as Record<(typeof MASS2_PROVIDER_SPECS)[number]["id"], ReturnType<typeof buildMass2Provider>>;

export const MASS2_PROVIDERS = MASS2_PROVIDER_SPECS.map((spec) => MASS2_BUNDLES[spec.id].provider);

export function mass2EditionCount(): number {
  return MASS2_PROVIDER_SPECS.reduce(
    (total, spec) => total + MASS2_BUNDLES[spec.id].editions.length,
    0,
  );
}
