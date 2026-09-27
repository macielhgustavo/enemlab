"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  ExternalLink,
  FileText,
  FlaskConical,
  Target,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { LoadingState } from "@/components/enem-lab/states";
import {
  contentNoteKey,
  contentRecoveryEvidence,
  contentRecoveryResource,
  recoveryTaxonomyPath,
  relatedContentErrors,
} from "@/lib/domain/content-recovery";
import { useHydrated } from "@/lib/hooks";
import { resolveProviderId } from "@/lib/providers";
import { examLabel } from "@/lib/providers/label";
import { areaLabel } from "@/lib/providers/taxonomy";
import { buildProviderContentAttempt } from "@/lib/services/provider-study";
import { useStore } from "@/lib/store";
import { shortSec } from "@/lib/format";

function decoded(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function ContentRecoveryPage() {
  const params = useParams<{ providerId: string; topic: string }>();
  const router = useRouter();
  const hydrated = useHydrated();
  const db = useStore((state) => state.db);
  const mutate = useStore((state) => state.mutate);
  const addAttempt = useStore((state) => state.addAttempt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!hydrated) {
    return (
      <Card>
        <LoadingState lines={5} label="Carregando ficha de recuperação" />
      </Card>
    );
  }

  const providerId = resolveProviderId(decoded(params.providerId));
  const topic = decoded(params.topic);
  const evidence = contentRecoveryEvidence(db, topic, providerId);
  const errors = relatedContentErrors(db, topic, providerId);
  const path = recoveryTaxonomyPath(db, topic, providerId);
  const resource = contentRecoveryResource(providerId, topic);
  const noteKey = contentNoteKey(providerId, topic);
  const personalNote = db.notes[noteKey]?.text ?? "";

  const status =
    evidence.state === "weak"
      ? {
          label: "gargalo confirmado",
          variant: "danger" as const,
          title: "Há evidência suficiente para tratar este conteúdo como prioridade.",
        }
      : evidence.state === "calibrating"
        ? {
            label: "calibração",
            variant: "info" as const,
            title: `A amostra ainda é curta. Falta${evidence.remainingForDecision === 1 ? "" : "m"} ${evidence.remainingForDecision} resposta${evidence.remainingForDecision === 1 ? "" : "s"} para a leitura mínima.`,
          }
        : evidence.state === "measured"
          ? {
              label: "medido",
              variant: "success" as const,
              title: "Há amostra suficiente, mas este conteúdo não cruza o corte atual de gargalo.",
            }
          : {
              label: "sem amostra",
              variant: "neutral" as const,
              title: "Ainda não há respostas corrigidas suficientes para avaliar este conteúdo.",
            };

  async function startTraining() {
    setBusy(true);
    setError("");
    try {
      const questions = evidence.state === "weak" ? 12 : 8;
      const attempt = await buildProviderContentAttempt(providerId, topic, questions);
      addAttempt(attempt);
      router.push(`/exam/${attempt.id}`);
    } catch (err) {
      setError((err as Error).message || "Não foi possível montar o treino deste conteúdo.");
      setBusy(false);
    }
  }

  function savePersonalNote(value: string) {
    mutate((current) => {
      const note = (current.notes[noteKey] ??= {});
      note.text = value;
    });
  }

  return (
    <div className="el-content-recovery">
      <PageHeader
        eyebrow="Recuperação · conteúdo"
        title={topic || "Conteúdo"}
        context={
          <>
            <Badge variant="accent">{examLabel(providerId)}</Badge>
            <Badge variant={status.variant}>{status.label}</Badge>
          </>
        }
        description={status.title}
        crumbs={[
          { label: "Domínio", href: "/mastery" },
          { label: topic || "Conteúdo" },
        ]}
        actions={
          <Button variant="primary" onClick={startTraining} loading={busy}>
            Treinar este conteúdo <ArrowRight size={15} aria-hidden="true" />
          </Button>
        }
      />

      {error ? <div className="el-notice el-notice--danger">{error}</div> : null}

      <div className="el-content-recovery__path" aria-label="Posição na taxonomia">
        {path.map((part, index) => (
          <span key={`${part}-${index}`}>{part}</span>
        ))}
      </div>

      <div className="el-content-recovery__grid">
        <Card className="el-content-recovery__evidence">
          <div className="el-content-recovery__section-head">
            <Target size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">EVIDÊNCIA ATUAL</span>
              <h2>O que os dados sustentam</h2>
            </div>
          </div>

          <div className="el-content-recovery__metrics">
            <div>
              <small>amostra</small>
              <strong>{evidence.t}</strong>
              <span>questões corrigidas</span>
            </div>
            <div>
              <small>acerto</small>
              <strong>{evidence.p === null ? "—" : `${evidence.p}%`}</strong>
              <span>{evidence.c}/{evidence.t || 0}</span>
            </div>
            <div>
              <small>IC95%</small>
              <strong>{evidence.ci ? `${evidence.ci.low}–${evidence.ci.high}%` : "—"}</strong>
              <span>incerteza explícita</span>
            </div>
          </div>

          {evidence.state === "calibrating" ? (
            <div className="el-content-recovery__calibration">
              <FlaskConical size={17} aria-hidden="true" />
              <div>
                <strong>Coletar evidência antes de rotular</strong>
                <span>
                  Com menos de 4 respostas, o Studium trata o sinal como calibração. Um resultado
                  ruim aqui ainda pode ser ruído de amostra.
                </span>
              </div>
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="el-content-recovery__section-head">
            <FileText size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">NOTA PESSOAL</span>
              <h2>O que você precisa lembrar</h2>
            </div>
          </div>
          <label className="el-content-recovery__note" htmlFor="content-personal-note">
            <span className="muted">Escreva com suas palavras. A nota fica no seu estado local e entra no sync normal.</span>
            <textarea
              id="content-personal-note"
              defaultValue={personalNote}
              placeholder="Ex.: eu erro quando somo percentuais sucessivos; revisar fator multiplicativo."
              onBlur={(event) => savePersonalNote(event.currentTarget.value)}
            />
            <small className="muted">Salva automaticamente ao sair do campo.</small>
          </label>
        </Card>
      </div>

      <div className="el-content-recovery__grid">
        <Card>
          <div className="el-content-recovery__section-head">
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">ERROS RELACIONADOS</span>
              <h2>Padrões recentes</h2>
            </div>
          </div>
          {errors.length ? (
            <div className="el-content-recovery__errors">
              {errors.map((item) => (
                <article key={`${item.attemptId}|${item.key}`}>
                  <div>
                    <strong>
                      {examLabel(providerId)} {item.year} · questão {item.index}
                    </strong>
                    <span>
                      {areaLabel(item.area, providerId)} · {item.confidence || "sem confiança"} ·{" "}
                      {shortSec(item.timeSec)}
                    </span>
                  </div>
                  <div>
                    {item.reason ? <Badge variant="warning">{item.reason}</Badge> : null}
                    {item.text ? <span className="muted">{item.text}</span> : null}
                  </div>
                  <Link href={`/result/${item.attemptId}/review`}>
                    Revisar <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="el-content-recovery__empty">
              <span>Nenhum erro relacionado foi registrado nesta prova.</span>
            </div>
          )}
        </Card>

        <Card>
          <div className="el-content-recovery__section-head">
            <BookOpenText size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">RECUPERAÇÃO</span>
              <h2>Resumo próprio e referências</h2>
            </div>
          </div>

          {resource ? (
            <div className="el-content-recovery__resource">
              <p>{resource.summary}</p>
              {resource.formulas.length ? (
                <div>
                  <strong>Fórmulas-chave</strong>
                  <div className="el-content-recovery__formulas">
                    {resource.formulas.map((formula) => (
                      <code key={formula}>{formula}</code>
                    ))}
                  </div>
                </div>
              ) : null}
              <div>
                <strong>Referências externas selecionadas</strong>
                <div className="el-content-recovery__references">
                  {resource.references.map((reference) => (
                    <a
                      key={reference.url}
                      href={reference.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>
                        {reference.label}
                        <small>{reference.note}</small>
                      </span>
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="el-content-recovery__empty">
              <strong>Ainda não há resumo próprio para este conteúdo.</strong>
              <span>
                O Studium não copia material de terceiros. Quando houver conteúdo produzido pelo
                projeto ou uma referência externa selecionada, ele aparece aqui.
              </span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
