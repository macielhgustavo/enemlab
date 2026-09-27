"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpenText, Check, Clock3, History, Save, UserRoundCheck } from "lucide-react";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { LoadingState } from "@/components/enem-lab/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ESSAY_COMPETENCIES,
  finishEssayPractice,
  recordEssayEvaluation,
  saveEssayVersion,
} from "@/lib/domain/essay-study";
import type {
  EssayCompetencyId,
  EssayEvaluationSource,
} from "@/lib/domain/types";
import { shortSec } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";
import { examLabel } from "@/lib/providers/label";
import { useStore } from "@/lib/store";

type DraftState = {
  id: string;
  text: string;
  repertoire: string;
  improvements: string;
};

const SCORE_OPTIONS = [0, 40, 80, 120, 160, 200];

export default function EssayEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const hydrated = useHydrated();
  const db = useStore((state) => state.db);
  const mutate = useStore((state) => state.mutate);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [tick, setTick] = useState(0);
  const [source, setSource] = useState<EssayEvaluationSource>("self");
  const [authorLabel, setAuthorLabel] = useState("");
  const [feedback, setFeedback] = useState("");
  const [scores, setScores] = useState<Record<EssayCompetencyId, string>>({
    c1: "",
    c2: "",
    c3: "",
    c4: "",
    c5: "",
  });

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const essay = db.essays?.find((item) => item.id === id);

  if (!hydrated) {
    return (
      <Card>
        <LoadingState lines={6} label="Carregando redação" />
      </Card>
    );
  }

  if (!essay) {
    return (
      <Card className="empty">
        Redação não encontrada. <Link href="/redacao">Voltar ao histórico</Link>
      </Card>
    );
  }

  const draft =
    draftState?.id === id
      ? draftState
      : {
          id,
          text: essay.text,
          repertoire: essay.repertoire,
          improvements: essay.improvements,
        };
  const elapsedSec = essay.elapsedSec + (essay.finishedAt ? 0 : tick);
  const remainingSec = essay.timeLimitMin
    ? Math.max(0, essay.timeLimitMin * 60 - elapsedSec)
    : null;
  const wordCount = (draft.text.trim().match(/\S+/g) || []).length;
  const lineEstimate = draft.text.trim()
    ? Math.max(1, Math.ceil(draft.text.trim().length / 65))
    : 0;
  const isEnem = essay.providerId === "enem";

  function patchDraft(patch: Partial<DraftState>) {
    setDraftState({ ...draft, ...patch });
  }

  function persistVersion() {
    const now = new Date().toISOString();
    mutate((current) => {
      const target = current.essays?.find((item) => item.id === id);
      if (!target) return;
      saveEssayVersion(target, {
        text: draft.text,
        repertoire: draft.repertoire,
        improvements: draft.improvements,
        elapsedSec,
        now,
      });
    });
    setTick(0);
  }

  function finish() {
    const now = new Date().toISOString();
    mutate((current) => {
      const target = current.essays?.find((item) => item.id === id);
      if (!target) return;
      finishEssayPractice(target, {
        text: draft.text,
        repertoire: draft.repertoire,
        improvements: draft.improvements,
        elapsedSec,
        now,
      });
    });
    setTick(0);
  }

  function addEvaluation() {
    const competencies = Object.fromEntries(
      ESSAY_COMPETENCIES.flatMap((competency) => {
        const raw = scores[competency.id];
        return raw === "" ? [] : [[competency.id, Number(raw)]];
      }),
    ) as Partial<Record<EssayCompetencyId, number>>;

    mutate((current) => {
      const target = current.essays?.find((item) => item.id === id);
      if (!target) return;
      recordEssayEvaluation(target, {
        source,
        authorLabel,
        competencies: isEnem ? competencies : {},
        feedback,
      });
    });
    setFeedback("");
    setAuthorLabel("");
    setScores({ c1: "", c2: "", c3: "", c4: "", c5: "" });
  }

  const canEvaluate =
    source === "external"
      ? Boolean(authorLabel.trim() || feedback.trim() || Object.values(scores).some(Boolean))
      : !isEnem || Object.values(scores).some(Boolean) || Boolean(feedback.trim());

  return (
    <div className="el-essay-editor">
      <PageHeader
        eyebrow="Redação · sessão"
        title={essay.theme}
        description="Seu texto é salvo no mesmo estado local do restante dos estudos. Avaliações registradas abaixo são evidências manuais, não correção oficial por IA."
        context={
          <>
            <Badge variant="accent">{examLabel(essay.providerId)}</Badge>
            <Badge variant={essay.finishedAt ? "success" : "warning"}>
              {essay.finishedAt ? "concluída" : "em andamento"}
            </Badge>
          </>
        }
        crumbs={[
          { label: "Redação", href: "/redacao" },
          { label: "Sessão" },
        ]}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/redacao">Voltar ao histórico</Link>
          </Button>
        }
      />

      <div className="el-essay-editor__status">
        <Card padding="sm">
          <Clock3 size={16} aria-hidden="true" />
          <div>
            <span className="caption">Tempo registrado</span>
            <strong>{shortSec(elapsedSec)}</strong>
          </div>
        </Card>
        <Card padding="sm">
          <BookOpenText size={16} aria-hidden="true" />
          <div>
            <span className="caption">Texto</span>
            <strong>{wordCount} palavras · ~{lineEstimate} linhas</strong>
          </div>
        </Card>
        <Card padding="sm">
          <History size={16} aria-hidden="true" />
          <div>
            <span className="caption">Versões</span>
            <strong>{essay.versions?.length || 0}</strong>
          </div>
        </Card>
        {remainingSec !== null ? (
          <Card padding="sm" variant={remainingSec === 0 ? "danger" : "default"}>
            <Clock3 size={16} aria-hidden="true" />
            <div>
              <span className="caption">Limite escolhido</span>
              <strong>{remainingSec ? shortSec(remainingSec) : "tempo encerrado"}</strong>
            </div>
          </Card>
        ) : null}
      </div>

      <Card className="el-essay-writing">
        <label htmlFor="essay-text">
          <span className="eyebrow">TEXTO</span>
          <textarea
            id="essay-text"
            value={draft.text}
            onChange={(event) => patchDraft({ text: event.target.value })}
            placeholder="Escreva seu texto aqui. O Studium não completa a redação por você."
            disabled={Boolean(essay.finishedAt)}
          />
        </label>

        <div className="el-essay-writing__notes">
          <label htmlFor="essay-repertoire">
            <span>Repertório usado ou que você quer lembrar</span>
            <textarea
              id="essay-repertoire"
              value={draft.repertoire}
              onChange={(event) => patchDraft({ repertoire: event.target.value })}
              placeholder="Autores, dados, obras ou referências que você decidiu usar."
              disabled={Boolean(essay.finishedAt)}
            />
          </label>
          <label htmlFor="essay-improvements">
            <span>Pontos a melhorar</span>
            <textarea
              id="essay-improvements"
              value={draft.improvements}
              onChange={(event) => patchDraft({ improvements: event.target.value })}
              placeholder="Ex.: tornar a tese mais explícita; conectar melhor o segundo argumento."
              disabled={Boolean(essay.finishedAt)}
            />
          </label>
        </div>

        {!essay.finishedAt ? (
          <div className="el-essay-writing__actions">
            <Button variant="secondary" onClick={persistVersion}>
              <Save size={15} aria-hidden="true" /> Salvar versão
            </Button>
            <Button variant="primary" onClick={finish} disabled={!draft.text.trim()}>
              <Check size={15} aria-hidden="true" /> Concluir texto
            </Button>
          </div>
        ) : null}
      </Card>

      {essay.versions?.length ? (
        <Card>
          <div className="el-essay-section-head">
            <History size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">VERSÕES</span>
              <h2>Histórico do texto</h2>
            </div>
          </div>
          <div className="el-essay-version-list">
            {[...essay.versions].reverse().map((version, index) => (
              <details key={`${version.at}-${index}`}>
                <summary>
                  {new Date(version.at).toLocaleString("pt-BR")} ·{" "}
                  {(version.text.trim().match(/\S+/g) || []).length} palavras
                </summary>
                <p>{version.text || "Versão vazia."}</p>
              </details>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="el-essay-evaluation">
        <div className="el-essay-section-head">
          <UserRoundCheck size={18} aria-hidden="true" />
          <div>
            <span className="eyebrow">AVALIAÇÃO REGISTRADA</span>
            <h2>Adicionar autoavaliação ou feedback manual</h2>
          </div>
        </div>

        <div className="el-essay-evaluation__meta">
          <label>
            <span>Origem</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as EssayEvaluationSource)}
            >
              <option value="self">Autoavaliação</option>
              <option value="external">Feedback externo/manual</option>
            </select>
          </label>
          {source === "external" ? (
            <label>
              <span>Quem forneceu</span>
              <input
                value={authorLabel}
                onChange={(event) => setAuthorLabel(event.target.value)}
                placeholder="Ex.: professora Ana, corretor do cursinho"
              />
            </label>
          ) : null}
        </div>

        {isEnem ? (
          <>
            <p className="muted body-sm">
              Registre valores de 0 a 200 por competência somente quando você ou outra pessoa tiver feito essa avaliação. O Studium apenas armazena e calcula médias desses registros.
            </p>
            <div className="el-essay-evaluation__scores">
              {ESSAY_COMPETENCIES.map((competency) => (
                <label key={competency.id}>
                  <span>
                    <strong>{competency.short}</strong> · {competency.label}
                  </span>
                  <select
                    value={scores[competency.id]}
                    onChange={(event) =>
                      setScores((current) => ({
                        ...current,
                        [competency.id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Não avaliada</option>
                    {SCORE_OPTIONS.map((score) => (
                      <option value={score} key={score}>
                        {score}/200
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </>
        ) : (
          <p className="muted body-sm">
            As cinco competências são específicas do fluxo ENEM. Para esta prova, registre apenas o feedback manual.
          </p>
        )}

        <label className="el-essay-evaluation__feedback">
          <span>Comentário da avaliação</span>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Registre o feedback recebido ou sua análise do texto."
          />
        </label>
        <Button variant="primary" onClick={addEvaluation} disabled={!canEvaluate}>
          Registrar avaliação
        </Button>
      </Card>

      <Card>
        <div className="el-essay-section-head">
          <History size={18} aria-hidden="true" />
          <div>
            <span className="eyebrow">AVALIAÇÕES</span>
            <h2>Quem avaliou e o que foi registrado</h2>
          </div>
        </div>

        {essay.evaluations?.length ? (
          <div className="el-essay-evaluation-list">
            {[...essay.evaluations].reverse().map((evaluation) => (
              <article key={evaluation.id}>
                <div>
                  <Badge variant={evaluation.source === "self" ? "accent" : "outline"}>
                    {evaluation.source === "self" ? "autoavaliação" : "externo/manual"}
                  </Badge>
                  <strong>{evaluation.authorLabel}</strong>
                  <span className="caption muted">
                    {new Date(evaluation.at).toLocaleString("pt-BR")}
                  </span>
                </div>
                {isEnem ? (
                  <div className="el-essay-evaluation-list__scores">
                    {ESSAY_COMPETENCIES.map((competency) => (
                      <span key={competency.id}>
                        {competency.short}:{" "}
                        <b>{evaluation.competencies?.[competency.id] ?? "—"}</b>
                      </span>
                    ))}
                  </div>
                ) : null}
                {evaluation.feedback ? <p>{evaluation.feedback}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">Nenhuma avaliação foi registrada para este texto.</p>
        )}
      </Card>
    </div>
  );
}
