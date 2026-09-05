// Validação de backups importados.
//
// Regra de ouro: nunca descartar dados do usuário. Todos os objetos são
// "loose" (Zod preserva chaves desconhecidas), então backups de versões
// futuras ou com campos extras atravessam intactos. A validação existe
// para rejeitar arquivo errado/corrompido, não para normalizar o schema.
import { z } from "zod";
import { resolveProviderId } from "../providers/registry";
import type { DB } from "../domain/types";

const alternativeKey = z.string();

const attemptSchema = z.looseObject({
  id: z.string().min(1),
  year: z.number().int(),
  // Ausente nos dados legados: resolvido como ENEM na leitura.
  providerId: z.string().optional(),
  answers: z.record(alternativeKey, z.unknown()).optional(),
  result: z.unknown().optional(),
});

export const backupSchema = z.looseObject({
  attempts: z.array(attemptSchema),
  notes: z.record(z.string(), z.unknown()).optional(),
  srs: z.record(z.string(), z.unknown()).optional(),
  sessions: z.array(z.unknown()).optional(),
  goals: z.looseObject({}).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  schema: z.number().optional(),
  build: z.string().optional(),
});

export type ParsedBackup =
  | { ok: true; data: DB; attempts: number; providers: string[] }
  | { ok: false; error: string };

/** Interpreta o conteúdo de um arquivo de backup. */
export function parseBackup(raw: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Arquivo não é JSON válido." };
  }

  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    return {
      ok: false,
      error: path
        ? `Backup inválido em "${path}": ${issue.message}`
        : "Backup inválido: estrutura não reconhecida.",
    };
  }

  const data = parsed.data as unknown as DB;
  const providers = [
    ...new Set(
      (data.attempts || []).map((a) =>
        resolveProviderId((a as { providerId?: string }).providerId),
      ),
    ),
  ];
  return { ok: true, data, attempts: data.attempts?.length ?? 0, providers };
}
