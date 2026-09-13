"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileCheck2, Upload } from "lucide-react";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { Button, Card } from "@/components/ui";
import { BrowserReviewDecisionStore } from "@/lib/ingestion/browserReviewStore";
import {
  buildReviewContentFingerprint,
  handoffReviewedJobToCatalog,
  recordReviewDecision,
  type ApprovedValidationLevel,
  type IngestionReviewDecision,
  type ReviewDisposition,
  type ReviewedCatalogHandoff,
} from "@/lib/ingestion/review";
import type { IngestionJobResult } from "@/lib/ingestion/types";

interface ReviewExportArtifact {
  schemaVersion: 1;
  exportedAt: string;
  jobIdentity: {
    jobKey: string;
    providerId: string;
    sourceId: string;
    editionId: string;
    year: number;
    phase: string;
    variant?: string;
  };
  contentFingerprint: string;
  decision: IngestionReviewDecision;
  handoff: ReviewedCatalogHandoff | null;
}

function asReviewableJob(value: unknown): IngestionJobResult {
  if (!value || typeof value !== "object") throw new Error("JSON inválido.");
  const job = value as Partial<IngestionJobResult>;
  if (job.status !== "ready-for-review") {
    throw new Error("O artifact precisa estar em status ready-for-review.");
  }
  if (!job.jobKey || !job.providerId || !job.sourceId || !job.editionId) {
    throw new Error("Artifact sem identidade estrutural completa.");
  }
  if (!job.stagedExam || !job.report) {
    throw new Error("Artifact sem stagedExam/report; nada pode ser revisado.");
  }
  return job as IngestionJobResult;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function IngestionReviewPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const store = useMemo(() => new BrowserReviewDecisionStore(), []);
  const [job, setJob] = useState<IngestionJobResult | null>(null);
  const [fingerprint, setFingerprint] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [level, setLevel] = useState<ApprovedValidationLevel>("reviewed");
  const [decision, setDecision] = useState<IngestionReviewDecision | null>(null);
  const [handoff, setHandoff] = useState<ReviewedCatalogHandoff | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function importArtifact(file: File) {
    setBusy(true);
    setError("");
    setDecision(null);
    setHandoff(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const next = asReviewableJob(parsed);
      const nextFingerprint = await buildReviewContentFingerprint(next);
      const previous = await store.get(next.jobKey);
      setJob(next);
      setFingerprint(nextFingerprint);
      if (previous?.contentFingerprint === nextFingerprint) setDecision(previous);
    } catch (err) {
      setJob(null);
      setFingerprint("");
      setError((err as Error).message || "Não foi possível carregar o artifact.");
    } finally {
      setBusy(false);
    }
  }

  async function review(disposition: ReviewDisposition) {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const saved = await recordReviewDecision(store, job, {
        disposition,
        validationLevel: disposition === "approved" ? level : undefined,
        reviewer,
        notes,
      });
      setDecision(saved);
      const nextHandoff = disposition === "approved"
        ? await handoffReviewedJobToCatalog(store, job)
        : null;
      setHandoff(nextHandoff);
    } catch (err) {
      setError((err as Error).message || "Falha ao registrar revisão.");
    } finally {
      setBusy(false);
    }
  }

  function exportReview() {
    if (!job || !decision) return;
    const artifact: ReviewExportArtifact = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      jobIdentity: {
        jobKey: job.jobKey,
        providerId: job.providerId,
        sourceId: job.sourceId,
        editionId: job.editionId,
        year: job.year,
        phase: job.phase,
        variant: job.variant,
      },
      contentFingerprint: decision.contentFingerprint,
      decision,
      handoff,
    };
    const safe = `${job.providerId}-${job.editionId}-${job.phase}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
    downloadJson(`${safe}-review.json`, artifact);
  }

  const raw = job?.stagedExam?.raw;
  const report = job?.report;
  const questions = job?.stagedExam?.questions ?? [];
  const semanticIssues = job?.stagedExam?.semanticFidelityIssues ?? [];
  const missingMedia = job?.stagedExam?.questionsMissingMedia ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Dados · ingestion"
        title="Revisão humana de ingestão"
        description="Carregue um job ready-for-review, confira evidências e registre uma decisão ligada ao fingerprint exato do conteúdo. Nada é publicado automaticamente."
      />

      <div className="row" style={{ marginBottom: 14 }}>
        <Button asChild variant="secondary" size="sm">
          <Link href="/data"><ArrowLeft size={14} /> Voltar para Dados</Link>
        </Button>
        <Button variant="primary" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={14} /> Carregar artifact JSON
        </Button>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importArtifact(file);
            event.currentTarget.value = "";
          }}
        />
      </div>

      {error && <div className="notice" role="alert" style={{ marginBottom: 14 }}>{error}</div>}

      {!job ? (
        <Card>
          <h2>Nenhum job carregado</h2>
          <p className="muted">A ferramenta aceita somente saídas da engine em <code>ready-for-review</code>. Jobs incompletos, bloqueados ou sem relatório são recusados.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid2">
            <Card>
              <h2>Identidade</h2>
              <div className="healthGrid" style={{ marginTop: 12 }}>
                <div className="healthItem"><small>Provider</small><b>{job.providerId}</b></div>
                <div className="healthItem"><small>Edição</small><b>{job.editionId}</b></div>
                <div className="healthItem"><small>Fase</small><b>{job.phase}</b></div>
                <div className="healthItem"><small>Variante</small><b>{job.variant || "—"}</b></div>
                <div className="healthItem"><small>Fonte</small><b>{job.sourceId}</b></div>
                <div className="healthItem"><small>Ano</small><b>{job.year}</b></div>
              </div>
              <div className="muted mono" style={{ marginTop: 12, overflowWrap: "anywhere" }}>
                jobKey: {job.jobKey}
              </div>
              <div className="muted mono" style={{ marginTop: 6, overflowWrap: "anywhere" }}>
                fingerprint: {fingerprint}
              </div>
            </Card>

            <Card>
              <h2>Gates</h2>
              <div className="healthGrid" style={{ marginTop: 12 }}>
                <div className="healthItem"><small>Questões</small><b>{questions.length}</b></div>
                <div className="healthItem"><small>Esperadas</small><b>{report?.objectiveExpected ?? "—"}</b></div>
                <div className="healthItem"><small>Gabaritos casados</small><b>{report?.answerKeysMatched ?? "—"}</b></div>
                <div className="healthItem"><small>Mídia ausente</small><b>{missingMedia.length}</b></div>
                <div className="healthItem"><small>Issues semânticos</small><b>{semanticIssues.length}</b></div>
                <div className="healthItem"><small>Validação automática</small><b>{report?.validation ?? "—"}</b></div>
              </div>
            </Card>
          </div>

          <Card style={{ marginTop: 14 }}>
            <h2>Documentos e fingerprints</h2>
            <div className="tablewrap" role="region" aria-label="Documentos ingeridos" tabIndex={0} style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>URL</th><th>SHA-256</th><th>Bytes</th><th>Parser</th></tr></thead>
                <tbody>
                  {(raw?.fingerprints ?? []).map((item) => (
                    <tr key={`${item.url}:${item.sha256}`}>
                      <td className="mono" style={{ maxWidth: 360, overflowWrap: "anywhere" }}>{item.url}</td>
                      <td className="mono">{item.sha256.slice(0, 16)}…</td>
                      <td>{item.contentLength}</td>
                      <td className="mono">{item.parserVersion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {(report?.issues?.length || semanticIssues.length || missingMedia.length) ? (
            <Card style={{ marginTop: 14 }}>
              <h2>Exceções para revisão</h2>
              <div className="testGrid" style={{ marginTop: 10 }}>
                {(report?.issues ?? []).map((issue, index) => (
                  <div className="testRow" key={`report-${index}`}>
                    <span className={`testDot ${issue.fatal ? "bad" : "warn"}`} />
                    <div><b>{issue.code}</b><div className="muted">{issue.message}</div></div>
                    <span className="badge2">{issue.fatal ? "fatal" : "aviso"}</span>
                  </div>
                ))}
                {semanticIssues.map((issue, index) => (
                  <div className="testRow" key={`semantic-${index}`}>
                    <span className="testDot warn" />
                    <div><b>{issue.code}</b><div className="muted">{issue.message}</div></div>
                    <span className="badge2">semântico</span>
                  </div>
                ))}
                {missingMedia.length > 0 && (
                  <div className="testRow">
                    <span className="testDot warn" />
                    <div><b>Mídia ausente</b><div className="muted">Questões: {missingMedia.join(", ")}</div></div>
                    <span className="badge2">mídia</span>
                  </div>
                )}
              </div>
            </Card>
          ) : null}

          <Card style={{ marginTop: 14 }}>
            <h2>Decisão humana</h2>
            <div className="grid grid2" style={{ marginTop: 10 }}>
              <div>
                <label htmlFor="reviewer">Revisor</label>
                <input id="reviewer" value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="nome ou identificador" />
              </div>
              <div>
                <label htmlFor="level">Nível concedido se aprovado</label>
                <select id="level" value={level} onChange={(event) => setLevel(event.target.value as ApprovedValidationLevel)}>
                  <option value="reviewed">reviewed</option>
                  <option value="verified">verified</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label htmlFor="review-notes">Notas</label>
              <textarea id="review-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} placeholder="o que foi conferido, ressalvas, páginas ou correções necessárias" />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <Button variant="primary" disabled={busy || !reviewer.trim()} onClick={() => void review("approved")}>
                <FileCheck2 size={14} /> Aprovar
              </Button>
              <Button variant="secondary" disabled={busy || !reviewer.trim()} onClick={() => void review("needs-changes")}>Precisa correção</Button>
              <Button variant="danger" disabled={busy || !reviewer.trim()} onClick={() => void review("rejected")}>Rejeitar</Button>
            </div>
          </Card>

          {decision && (
            <Card style={{ marginTop: 14 }}>
              <div className="row between">
                <div>
                  <span className="tele">DECISÃO REGISTRADA</span>
                  <h2>{decision.disposition}</h2>
                  <div className="muted">{decision.reviewer} · {new Date(decision.reviewedAt).toLocaleString("pt-BR")}</div>
                  {decision.disposition === "approved" && (
                    <div className="muted" style={{ marginTop: 5 }}>
                      {handoff ? `handoff pronto: ${handoff.edition.validation}` : "aprovação não produziu handoff; revise os gates"}
                    </div>
                  )}
                </div>
                <Button variant="secondary" onClick={exportReview}>
                  <Download size={14} /> Exportar decisão
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
