"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Flag, XCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { areaLabel } from "@/lib/providers/taxonomy";
import { examLabel } from "@/lib/providers/label";
import { discipline } from "@/lib/domain/classify";
import { markdownImageUrls, richText, safeUrl, shortSec } from "@/lib/format";
import { questionsForAttempt } from "@/lib/services/attempts";
import MathContent from "@/components/MathContent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import type { Question, ResultRow } from "@/lib/domain/types";

type ReviewFilter = "all" | "wrong" | "correct" | "blank" | "flagged";

const FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "wrong", label: "Erradas" },
  { id: "blank", label: "Em branco" },
  { id: "flagged", label: "Marcadas" },
  { id: "correct", label: "Certas" },
];

function statusOf(row: ResultRow): "correct" | "wrong" | "blank" {
  if (!row.selected) return "blank";
  return row.isCorrect ? "correct" : "wrong";
}

function rowMatches(row: ResultRow, filter: ReviewFilter): boolean {
  if (filter === "all") return true;
  if (filter === "flagged") return row.flagged;
  return statusOf(row) === filter;
}

function findQuestion(questions: Question[], row: ResultRow): Question | undefined {
  return (
    questions.find((q) => q.index === row.index && discipline(q) === row.area) ||
    questions.find((q) => q.index === row.index)
  );
}

export default function ResultReviewPage() {
  const params = useParams();
  const id = params.id as string;
  const hydrated = useHydrated();
  const attempt = useStore((s) => s.db.attempts.find((a) => a.id === id));
  const [filter, setFilter] = useState<ReviewFilter>("wrong");
  const [position, setPosition] = useState(0);

  const { data: questions, isLoading, error } = useQuery({
    queryKey: ["attempt-questions", id, "review"],
    queryFn: () => questionsForAttempt(attempt!),
    enabled: hydrated && !!attempt?.result,
    staleTime: Infinity,
  });

  const resultRows = attempt?.result?.rows;
  const rows = useMemo(() => resultRows || [], [resultRows]);
  const filtered = useMemo(() => rows.filter((row) => rowMatches(row, filter)), [rows, filter]);
  const currentPosition = Math.min(position, Math.max(0, filtered.length - 1));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPosition((value) => Math.max(0, value - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPosition((value) => Math.min(Math.max(0, filtered.length - 1), value + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered.length]);

  if (!hydrated) return <Card><span className="muted">Carregando revisão…</span></Card>;
  if (!attempt?.result)
    return (
      <Card className="empty">
        Resultado não encontrado. <Link href="/history">Ver histórico</Link>
      </Card>
    );

  const counts = {
    all: rows.length,
    wrong: rows.filter((row) => statusOf(row) === "wrong").length,
    correct: rows.filter((row) => statusOf(row) === "correct").length,
    blank: rows.filter((row) => statusOf(row) === "blank").length,
    flagged: rows.filter((row) => row.flagged).length,
  };

  const row = filtered[currentPosition];
  const question = row && questions ? findQuestion(questions, row) : undefined;

  return (
    <div className="resultReviewPage">
      <PageHeader
        eyebrow="Correção"
        title="Questão por questão"
        context={
          <Badge variant="accent">
            {examLabel(attempt.providerId)} {attempt.year}
          </Badge>
        }
        crumbs={[
          { label: "Histórico", href: "/history" },
          { label: "Resultado", href: `/result/${id}` },
          { label: "Correção" },
        ]}
        description="Revise resposta, gabarito, confiança, tempo e conteúdo sem perder o contexto da prova."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/result/${id}`}>Voltar ao resultado</Link>
          </Button>
        }
      />

      <div className="resultReviewLayout">
        <aside className="resultReviewRail" aria-label="Navegação da correção">
          {/* Era `role="tablist"` com `role="tab"`, mas sem `tabpanel` do outro
              lado — e isto não são abas: é um filtro sobre a mesma lista. Um
              grupo de botões de alternar com `aria-pressed` descreve o que a
              tela realmente faz. */}
          <div className="resultReviewFilters" role="group" aria-label="Filtrar questões">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={filter === item.id ? "active" : ""}
                onClick={() => {
                  setFilter(item.id);
                  setPosition(0);
                }}
                aria-pressed={filter === item.id}
              >
                <span>{item.label}</span>
                <b>{counts[item.id]}</b>
              </button>
            ))}
          </div>

          <div className="resultReviewLegend" aria-hidden="true">
            <span><i className="correct" /> certa</span>
            <span><i className="wrong" /> errada</span>
            <span><i className="blank" /> em branco</span>
            <span><i className="flagged" /> marcada</span>
          </div>

          <div className="resultReviewGrid">
            {filtered.map((item, index) => {
              const status = statusOf(item);
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`${status} ${item.flagged ? "flagged" : ""} ${index === currentPosition ? "current" : ""}`}
                  onClick={() => setPosition(index)}
                  aria-label={`Questão ${item.index}, ${status === "correct" ? "certa" : status === "wrong" ? "errada" : "em branco"}${item.flagged ? ", marcada" : ""}`}
                  aria-current={index === currentPosition ? "true" : undefined}
                >
                  {item.index}
                </button>
              );
            })}
          </div>
        </aside>

        <main className="resultReviewMain">
          {!filtered.length ? (
            <Card className="empty">Nenhuma questão neste filtro.</Card>
          ) : isLoading || !questions ? (
            <Card className="resultReviewQuestionCard">
              <div className="loadingQuestion">
                <span className="loader" />
              </div>
            </Card>
          ) : error || !question || !row ? (
            <Card className="empty">Não foi possível carregar esta questão para revisão.</Card>
          ) : (
            <ReviewQuestion
              row={row}
              question={question}
              providerId={attempt.providerId}
              position={currentPosition}
              total={filtered.length}
            />
          )}

          {!!filtered.length && (
            <div className="resultReviewPager">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPosition((value) => Math.max(0, value - 1))}
                disabled={currentPosition === 0}
              >
                <ArrowLeft size={15} /> anterior
              </Button>
              <span>
                {currentPosition + 1} de {filtered.length}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPosition((value) => Math.min(filtered.length - 1, value + 1))}
                disabled={currentPosition >= filtered.length - 1}
              >
                próxima <ArrowRight size={15} />
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ReviewQuestion({
  row,
  question,
  providerId,
  position,
  total,
}: {
  row: ResultRow;
  question: Question;
  /** Banca da tentativa: define em que taxonomia o nome da área é lido. */
  providerId?: string | null;
  position: number;
  total: number;
}) {
  const status = statusOf(row);
  const embeddedUrls = new Set([
    ...markdownImageUrls(question.context),
    ...markdownImageUrls(question.alternativesIntroduction),
    ...(question.alternatives || []).flatMap((alt) => markdownImageUrls(alt.text)),
  ]);
  const standaloneFiles = (question.files || [])
    .map(String)
    .map(safeUrl)
    .filter((src) => src && !embeddedUrls.has(src));

  return (
    <Card className="resultReviewQuestionCard">
      <div className="resultReviewQuestionTop">
        <div>
          <span className="resultReviewEyebrow">QUESTÃO {row.index} · {position + 1}/{total}</span>
          <h2>{areaLabel(row.area, providerId)}</h2>
          <div className="resultReviewPath">{row.content}</div>
        </div>
        <span className={`resultReviewStatus ${status}`}>
          {status === "correct" ? <Check size={15} /> : status === "wrong" ? <XCircle size={15} /> : "—"}
          {status === "correct" ? "acerto" : status === "wrong" ? "erro" : "em branco"}
        </span>
      </div>

      <div className="resultReviewTelemetry">
        <span><small>Sua resposta</small><b>{row.selected || "—"}</b></span>
        <span><small>Gabarito</small><b>{row.correct || "—"}</b></span>
        <span><small>Confiança</small><b>{row.confidence || "—"}</b></span>
        <span><small>Tempo</small><b>{shortSec(row.timeSec)}</b></span>
        {row.pass ? <span><small>Passagem</small><b>{row.pass}ª</b></span> : null}
        {row.flagged ? <span className="flag"><small>Estado</small><b><Flag size={13} /> marcada</b></span> : null}
      </div>

      <section className="resultReviewQuestionBody" aria-label={`Revisão da questão ${row.index}`}>
        {question.context && <MathContent className="context" html={richText(question.context)} />}

        {standaloneFiles.length > 0 && (
          <div className="qImages">
            {standaloneFiles.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="Imagem da questão" data-zoomable="true" />
            ))}
          </div>
        )}

        {question.alternativesIntroduction && (
          <MathContent className="intro" html={richText(question.alternativesIntroduction)} />
        )}

        <div className="answers">
          {(question.alternatives || []).map((alt) => {
            const correct = alt.letter === row.correct;
            const selectedWrong = alt.letter === row.selected && !row.isCorrect;
            const file = safeUrl(alt.file || "");
            return (
              <div
                className={`answer ${correct ? "correctReview" : selectedWrong ? "wrongReview" : ""}`}
                key={alt.letter}
              >
                <span className="letter">{alt.letter}</span>
                <span className="altText">
                  <MathContent html={richText(alt.text || "")} />
                  {file ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="altImg" src={file} alt={`Imagem alternativa ${alt.letter}`} data-zoomable="true" />
                  ) : null}
                </span>
                <span className="resultReviewAltState">
                  {correct ? "gabarito" : selectedWrong ? "sua resposta" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </Card>
  );
}
