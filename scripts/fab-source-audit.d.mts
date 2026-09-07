export interface DocumentInput {
  url: string;
  archiveUrl?: string;
  sha256?: string;
  bytes?: number;
}
export interface DocumentResult {
  status: number;
  healthy: boolean;
  state?: string;
  error?: string | null;
}
export function isRecordedArchive(originalUrl: string, archiveUrl: string): boolean;
export function discoverFabEditions(text: string, provider: string): number[];
export function inspectPdf(url: string, expected: DocumentInput, fetcher?: typeof fetch): Promise<DocumentResult>;
export function auditArchivedDocument(document: DocumentInput, fetcher?: typeof fetch): Promise<{
  origin: DocumentResult; archive: DocumentResult; ok: boolean;
}>;
