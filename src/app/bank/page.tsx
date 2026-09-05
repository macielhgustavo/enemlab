"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { examYears, contentPath } from "@/lib/domain/constants";
import { classifyContent, discipline, questionKey } from "@/lib/domain/classify";
import { historicalQuestionRows, personalDifficulty, difficultyLabel } from "@/lib/domain/stats";
import { fetchExam } from "@/lib/api/enem";
import { normalizeText } from "@/lib/format";
import { attemptFromQuestions } from "@/lib/services/attempts";
import { Card, Empty } from "@/components/ui";
import { useToast } from "@/components/Toast";
import type { DB, Question } from "@/lib/domain/types";

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

  const [year, setYear] = useState(2023);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [status, setStatus] = useState("all");
  const [diff, setDiff] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const {
    data: questions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["exam", year, "ingles"],
    queryFn: () => fetchExam(year, "ingles"),
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
          (status === "all" || bankStatus(db, q) === status) &&
          (diff === "all" || d === diff)
        );
      })
      .slice(0, 250);
  }, [questions, query, area, status, diff, db]);

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
      <Card className="hero">
        <span className="pill">Banco explorável</span>
        <h1 style={{ fontSize: "clamp(30px,4vw,48px)" }}>
          Encontre exatamente o tipo de questão que quer treinar.
        </h1>
        <p>
          Filtre por ano, área, conteúdo, status e dificuldade pessoal estimada. Selecione
          itens e monte um treino customizado.
        </p>
      </Card>

      <Card style={{ marginTop: 14 }}>
        <div className="bankFilters">
          <input
            type="text"
            placeholder="Buscar no enunciado, conteúdo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {examYears().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="all">Todas as áreas</option>
            <option value="matematica">Matemática</option>
            <option value="ciencias-natureza">Natureza</option>
            <option value="ciencias-humanas">Humanas</option>
            <option value="linguagens">Linguagens</option>
          </select>
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
                    Q{q.index} • ENEM {q.year}
                  </b>
                  <div className="hierarchy">
                    {contentPath(c).map((p) => (
                      <span key={p}>{p}</span>
                    ))}
                  </div>
                  <div className="excerpt">
                    {String(q.context || q.alternativesIntroduction || "").replace(/\s+/g, " ")}
                  </div>
                </div>
                <div>
                  <span className={`badge2 ${dc}`}>{dl}</span>
                  <br />
                  <span className="badge2" style={{ marginTop: 5 }}>
                    {st}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
