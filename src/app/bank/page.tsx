"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { examYears, contentPath } from "@/lib/domain/constants";
import { classifyContent, discipline, questionKey } from "@/lib/domain/classify";
import { historicalQuestionRows, personalDifficulty, difficultyLabel } from "@/lib/domain/stats";
import { questionsFor } from "@/lib/providers/access";
import { ITA_PROVIDER_ID, itaYears, itaAnswerKey, getProvider } from "@/lib/providers";
import { useActiveProvider } from "@/components/ExamSwitch";
import { normalizeText } from "@/lib/format";
import { attemptFromQuestions } from "@/lib/services/attempts";
import { Card, Empty, PageHead } from "@/components/ui";
import { useToast } from "@/components/Toast";
import type { DB, Question } from "@/lib/domain/types";

// Rótulos de status com cor própria, como os chips do centro de controle.
const SUBJECT_PT: Record<string, string> = {
  mathematics: "Matemática",
  physics: "Física",
  chemistry: "Química",
  english: "Inglês",
  portuguese: "Português",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  unseen: { label: "Nunca vi", cls: "tagUnseen" },
  wrong: { label: "Já errei", cls: "tagWrong" },
  correct: { label: "Dominada", cls: "tagMastered" },
  srs: { label: "No SRS", cls: "tagSrs" },
};

function bankStatus(db: DB, q: Question): string {
  const k = questionKey(q);
  if (db.srs[k]) return "srs";
  const rr = historicalQuestionRows(db, k);
  if (!rr.length) return "unseen";
  return rr.some((x) => x.isCorrect === false) ? "wrong" : "correct";
}

export default function BankPage() {
  const db = useStore((s) => s.db);
  const addAttempt = useStore((s) => s.addAttempt);
  const router = useRouter();
  const { info } = useToast();
  const hydrated = useHydrated();

  // A prova vem do seletor global do shell.
  const { providerId } = useActiveProvider();
  const isIta = providerId === ITA_PROVIDER_ID;
  const [year, setYear] = useState(2023);
  const [itaYear, setItaYear] = useState(() => itaYears()[0] ?? 2026);
  const [subject, setSubject] = useState("all");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [status, setStatus] = useState("all");
  const [diff, setDiff] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const activeYear = isIta ? itaYear : year;

  const {
    data: questions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["exam", providerId, activeYear, "ingles"],
    queryFn: () => questionsFor(providerId, { year: activeYear, language: "ingles" }),
    enabled: hydrated,
    staleTime: Infinity,
  });

  const visible = useMemo(() => {
    if (!questions) return [];
    const nq = normalizeText(query);
    return questions
      .filter((q) => {
        const c = classifyContent(q);
        const txt = normalizeText([q.context, q.alternativesIntroduction, c].join(" "));
        const d = personalDifficulty(db, q);
        return (
          (!nq || txt.includes(nq)) &&
          (area === "all" || discipline(q) === area) &&
          (subject === "all" || discipline(q) === subject) &&
          (status === "all" || bankStatus(db, q) === status) &&
          (diff === "all" || d === diff)
        );
      })
      .slice(0, 250);
  }, [questions, query, area, subject, status, diff, db]);

  function toggle(k: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });
  }
  function selectVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((q) => next.add(questionKey(q)));
      return next;
    });
  }
  function start() {
    const qs = (questions || []).filter((q) => selected.has(questionKey(q)));
    if (!qs.length) {
      info("Selecione pelo menos uma questão.");
      return;
    }
    const a = attemptFromQuestions(qs[0].year, "ingles", qs, "bank");
    addAttempt(a);
    router.push(`/exam/${a.id}`);
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  return (
    <>
      <PageHead
        eyebrow="Módulo · acervo"
        title={`Banco de questões · ${getProvider(providerId).metadata.shortLabel}`}
        sub="Filtre por ano, área, conteúdo, status e dificuldade pessoal; selecione e monte um treino."
      />

      <Card>
        <div className="bankFilters">
          <input
            type="text"
            placeholder="Buscar no enunciado, conteúdo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isIta ? (
            <select value={itaYear} onChange={(e) => setItaYear(Number(e.target.value))}>
              {itaYears().map((y) => (
                <option key={y} value={y}>
                  ITA {y}
                </option>
              ))}
            </select>
          ) : (
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {examYears().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          {isIta ? (
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="all">Todas as matérias</option>
              {Object.keys(itaAnswerKey(itaYear)?.subjects ?? {}).map((id) => (
                <option key={id} value={id}>
                  {SUBJECT_PT[id] ?? id}
                </option>
              ))}
            </select>
          ) : (
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="all">Todas as áreas</option>
              <option value="matematica">Matemática</option>
              <option value="ciencias-natureza">Natureza</option>
              <option value="ciencias-humanas">Humanas</option>
              <option value="linguagens">Linguagens</option>
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Todos os status</option>
            <option value="unseen">Nunca vi</option>
            <option value="wrong">Já errei</option>
            <option value="correct">Já acertei</option>
            <option value="srs">No SRS</option>
          </select>
          <select value={diff} onChange={(e) => setDiff(e.target.value)}>
            <option value="all">Toda dificuldade</option>
            <option value="facil">Fácil pessoal</option>
            <option value="media">Média pessoal</option>
            <option value="dificil">Difícil pessoal</option>
          </select>
        </div>

        <div className="row between" style={{ margin: "12px 0" }}>
          <div className="muted">
            {isLoading
              ? "carregando banco…"
              : `${visible.length} visíveis • ${selected.size} selecionadas`}
          </div>
          <div className="row">
            <button className="btn secondary" onClick={selectVisible}>
              Selecionar visíveis
            </button>
            <button className="btn" onClick={start}>
              Treinar selecionadas
            </button>
          </div>
        </div>

        <div className="bankList">
          {isLoading && (
            <div className="empty">
              <span className="loader" style={{ display: "inline-block" }} />
              <br />
              Carregando banco…
            </div>
          )}
          {error && <Empty>Falha ao carregar: {(error as Error).message}</Empty>}
          {!isLoading && !error && visible.length === 0 && (
            <Empty>Nenhuma questão com esses filtros.</Empty>
          )}
          {visible.map((q) => {
            const k = questionKey(q);
            const c = classifyContent(q);
            const d = personalDifficulty(db, q);
            const [dl, dc] = difficultyLabel(d);
            const st = bankStatus(db, q);
            return (
              <div className="bankItem" key={k}>
                <input
                  type="checkbox"
                  checked={selected.has(k)}
                  onChange={(e) => toggle(k, e.target.checked)}
                />
                <div>
                  <b>
                    Q{q.number ?? q.index} • {q.official?.institution ?? "ENEM"} {q.year}
                  </b>
                  {q.statementAvailable === false ? (
                    <div className="hierarchy">
                      <span>{SUBJECT_PT[String(discipline(q))] ?? String(discipline(q))}</span>
                      <span>1ª fase</span>
                      <span>objetiva</span>
                    </div>
                  ) : (
                    <div className="hierarchy">
                      {contentPath(c).map((p) => (
                        <span key={p}>{p}</span>
                      ))}
                    </div>
                  )}
                  <div className="excerpt">
                    {q.statementAvailable === false
                      ? "Enunciado na prova oficial — abra o PDF do ITA para ler."
                      : String(q.context || q.alternativesIntroduction || "").replace(/\s+/g, " ")}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 5, justifyItems: "end" }}>
                  <span className={`badge2 ${dc}`}>{dl}</span>
                  <span className={`badge2 ${STATUS[st].cls}`}>{STATUS[st].label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
