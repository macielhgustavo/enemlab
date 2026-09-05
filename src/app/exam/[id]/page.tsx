"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { AREA_LABELS, LETTERS } from "@/lib/domain/constants";
import {
  classifyContent,
  discipline,
  questionKey,
} from "@/lib/domain/classify";
import { fmtSec, shortSec, richText, safeUrl, markdownImageUrls } from "@/lib/format";
import { questionsForAttempt, finishAttemptInDB } from "@/lib/services/attempts";
import { saveSnapshot } from "@/lib/idb";
import { QuestionSkeleton } from "@/components/Skeleton";
import MathContent from "@/components/MathContent";
import type { Confidence } from "@/lib/domain/types";

export default function ExamPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const hydrated = useHydrated();
  const mutate = useStore((s) => s.mutate);
  const attempt = useStore((s) => s.db.attempts.find((a) => a.id === id));

  const { data: questions, isLoading, error, refetch } = useQuery({
    queryKey: ["attempt-questions", id],
    queryFn: () => questionsForAttempt(attempt!),
    enabled: hydrated && !!attempt,
    staleTime: Infinity,
  });

  // ---- Estado de trabalho (inicializado da tentativa) ----
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<Record<string, Confidence>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [current, setCurrent] = useState(0);
  const [essayMode, setEssayMode] = useState(false);
  const [essayText, setEssayText] = useState("");
  const [pass, setPass] = useState(1);
  const [tick, setTick] = useState(0); // força re-render do cronômetro

  const timeQ = useRef<Record<string, number>>({});
  const elapsed = useRef(0);
  const qEntered = useRef<number | null>(null);
  const inited = useRef(false);
  const startMs = useRef<number>(Date.now());
  const passByQuestion = useRef<Record<string, number>>({});

  // Inicializa a partir da tentativa salva (uma vez).
  useEffect(() => {
    if (inited.current || !attempt) return;
    inited.current = true;
    setAnswers({ ...attempt.answers });
    setConfidence({ ...attempt.confidence });
    setFlags({ ...attempt.flags });
    timeQ.current = { ...attempt.timeQ };
    elapsed.current = attempt.elapsed || 0;
    setEssayText(attempt.essay?.text || "");
    setPass(attempt.pass || 1);
    passByQuestion.current = { ...(attempt.passByQuestion || {}) };
    startMs.current = new Date(attempt.startedAt).getTime();
    qEntered.current = Date.now();
  }, [attempt]);

  const qs = questions || [];
  const q = qs[current];
  const k = q ? questionKey(q) : "";

  const commitQTime = useCallback(() => {
    if (!q || qEntered.current === null || essayMode) return;
    const key = questionKey(q);
    timeQ.current[key] =
      (timeQ.current[key] || 0) + Math.max(0, Math.min(900, (Date.now() - qEntered.current) / 1000));
    qEntered.current = Date.now();
  }, [q, essayMode]);

  // Persiste o estado de trabalho na store.
  const commit = useCallback(
    (extra?: { finishedAt?: string }) => {
      mutate((db) => {
        const a = db.attempts.find((x) => x.id === id);
        if (!a) return;
        a.answers = { ...answers };
        a.confidence = { ...confidence };
        a.flags = { ...flags };
        a.timeQ = { ...timeQ.current };
        a.elapsed = elapsed.current;
        a.pass = pass;
        a.passByQuestion = { ...passByQuestion.current };
        if (a.essay) a.essay.text = essayText;
        if (extra?.finishedAt) a.finishedAt = extra.finishedAt;
      });
    },
    [answers, confidence, flags, essayText, pass, id, mutate],
  );

  // Cronômetro (1s).
  useEffect(() => {
    if (!attempt || attempt.finishedAt) return;
    const handle = setInterval(() => {
      const now = Date.now();
      if (attempt.strict) {
        elapsed.current = Math.max(elapsed.current, (now - startMs.current) / 1000);
      } else {
        elapsed.current += 1;
      }
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(handle);
  }, [attempt]);

  // Persiste periodicamente e ao sair.
  useEffect(() => {
    const iv = setInterval(() => commit(), 15000);
    return () => {
      clearInterval(iv);
      commitQTime();
      commit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit]);

  const goto = useCallback(
    (i: number) => {
      if (!qs.length || i < 0 || i >= qs.length) return;
      commitQTime();
      setCurrent(i);
      qEntered.current = Date.now();
      setEssayMode(false);
    },
    [qs.length, commitQTime],
  );

  // Pula para a próxima questão que satisfaz um predicado (circular).
  const jumpTo = useCallback(
    (predicate: (key: string) => boolean) => {
      if (!qs.length) return;
      for (let step = 1; step <= qs.length; step++) {
        const i = (current + step) % qs.length;
        if (predicate(questionKey(qs[i]))) {
          goto(i);
          return;
        }
      }
    },
    [qs, current, goto],
  );
  const nextUnanswered = useCallback(
    () => jumpTo((key) => !answers[key]),
    [jumpTo, answers],
  );
  const nextFlagged = useCallback(() => jumpTo((key) => !!flags[key]), [jumpTo, flags]);

  const answer = useCallback(
    (L: string) => {
      if (!q) return;
      const key = questionKey(q);
      if (attempt?.strategy) passByQuestion.current[key] = pass;
      setAnswers((prev) => ({ ...prev, [key]: L }));
    },
    [q, attempt?.strategy, pass],
  );
  const setConf = useCallback(
    (v: Confidence) => {
      if (!q) return;
      setConfidence((prev) => ({ ...prev, [questionKey(q)]: v }));
    },
    [q],
  );
  const toggleFlag = useCallback(() => {
    if (!q) return;
    setFlags((prev) => ({ ...prev, [questionKey(q)]: !prev[questionKey(q)] }));
  }, [q]);

  // Persiste logo após mudanças de resposta/confiança/flag.
  useEffect(() => {
    if (inited.current) commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, confidence, flags]);

  // Atalhos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (essayMode) return;
      const key = e.key.toUpperCase();
      if (LETTERS.includes(key as (typeof LETTERS)[number])) answer(key);
      else if (e.key === "ArrowLeft") goto(current - 1);
      else if (e.key === "ArrowRight") goto(current + 1);
      else if (e.key === "1") setConf("certeza");
      else if (e.key === "2") setConf("duvida");
      else if (e.key === "3") setConf("chute");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, goto, setConf, current, essayMode]);

  const finish = useCallback(() => {
    const blanks = qs.filter((qq) => !answers[questionKey(qq)]).length;
    if (!confirm(blanks ? `Há ${blanks} em branco. Finalizar?` : "Finalizar e corrigir?")) return;
    commitQTime();
    commit();
    mutate((db) => finishAttemptInDB(db, id, qs));
    void saveSnapshot(useStore.getState().db, "resultado");
    router.push(`/result/${id}`);
  }, [qs, answers, commit, commitQTime, mutate, id, router]);

  const reveal = useCallback(() => {
    mutate((db) => {
      const a = db.attempts.find((x) => x.id === id);
      if (a) a.revealedRecall = true;
    });
    qEntered.current = Date.now();
  }, [id, mutate]);

  const saveEssayVersion = useCallback(() => {
    mutate((db) => {
      const a = db.attempts.find((x) => x.id === id);
      if (!a?.essay) return;
      a.essay.text = essayText;
      a.essay.versions ||= [];
      a.essay.versions.push({ at: new Date().toISOString(), text: essayText });
      if (a.essay.versions.length > 12) a.essay.versions.shift();
    });
  }, [id, essayText, mutate]);

  const exportEssay = useCallback(() => {
    if (!attempt?.essay) return;
    const txt = `ENEM ${attempt.year}\nTema: ${attempt.essay.theme}\n\n${essayText}`;
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const u = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = u;
    el.download = `redacao_ENEM_${attempt.year}.txt`;
    el.click();
    URL.revokeObjectURL(u);
  }, [attempt?.essay, attempt?.year, essayText]);

  // Se a tentativa já está finalizada, vai direto ao resultado.
  const finished = !!(attempt?.finishedAt && attempt?.result);
  useEffect(() => {
    if (finished) router.replace(`/result/${id}`);
  }, [finished, id, router]);

  // ---- Derivados de exibição ----
  const answeredCount = useMemo(
    () => qs.filter((qq) => answers[questionKey(qq)]).length,
    [qs, answers],
  );
  const flaggedCount = useMemo(
    () => qs.filter((qq) => flags[questionKey(qq)]).length,
    [qs, flags],
  );

  const left = attempt ? Math.max(0, (attempt.minutes || 0) * 60 - elapsed.current) : 0;
  const qSec = q
    ? (timeQ.current[k] || 0) + (qEntered.current && !essayMode ? (Date.now() - qEntered.current) / 1000 : 0)
    : 0;
  // Alerta de ritmo
  let paceMsg = "";
  if (attempt?.alerts !== false && !essayMode && q) {
    const rem = qs.length - answeredCount;
    if (qSec > 240) paceMsg = `Você está há ${shortSec(qSec)} nesta questão.`;
    else if (left > 0 && rem > 0 && left / rem < 75)
      paceMsg = `Ritmo apertado: ~${Math.round(left / rem)}s por questão restante.`;
  }
  void tick;

  if (!hydrated) return <div className="card"><span className="muted">Carregando…</span></div>;
  if (!attempt)
    return (
      <div className="card empty">
        Tentativa não encontrada. <a href="/history">Ver histórico</a>
      </div>
    );
  if (finished) {
    return <div className="card"><span className="muted">Abrindo resultado…</span></div>;
  }
  if (isLoading || !questions) return <QuestionSkeleton />;
  if (error || !qs.length)
    return (
      <div className="card questionCard">
        <div className="loadingQuestion">
          <div>
            <b style={{ color: "var(--bad)" }}>Falha ao carregar.</b>
            <br />
            {(error as Error)?.message || "Nenhuma questão recuperada."}
            <br />
            <br />
            <button className="btn" onClick={() => refetch()}>
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    );

  const content = classifyContent(q);
  const selected = answers[k];
  const needRecall = !!attempt.activeRecall && !attempt.revealedRecall;

  // Imagens standalone (fora do enunciado markdown)
  const embeddedUrls = new Set([
    ...markdownImageUrls(q.context),
    ...markdownImageUrls(q.alternativesIntroduction),
    ...(q.alternatives || []).flatMap((x) => markdownImageUrls(x.text)),
  ]);
  const files = (q.files || []).map(String).filter((f) => !embeddedUrls.has(safeUrl(f)));

  return (
    <section className="examGrid">
      <div className="card questionCard">
        {essayMode && attempt.essay ? (
          <div className="essayEditor">
            <div className="questionTop">
              <div>
                <div className="qTitle">Redação • ENEM {attempt.year}</div>
                <div className="qArea">Texto dissertativo-argumentativo</div>
              </div>
              <button className="btn secondary" onClick={() => setEssayMode(false)}>
                Voltar às questões
              </button>
            </div>
            <div className="essayTheme">
              <b>Tema:</b>
              <br />
              {attempt.essay.theme}
              <br />
              <br />
              <span className="muted">
                Produza um texto dissertativo-argumentativo em norma-padrão, defendendo um
                ponto de vista e apresentando proposta de intervenção que respeite os direitos
                humanos.
              </span>
            </div>
            <div className="essayStats">
              <span className="badge2">
                {(essayText.trim().match(/\S+/g) || []).length} palavras
              </span>
              <span className="badge2">≈ {Math.max(1, Math.ceil(essayText.length / 65))} linhas</span>
              <span className="badge2">{attempt.essay.versions?.length || 0} versão(ões)</span>
            </div>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="btn secondary" onClick={saveEssayVersion}>
                Salvar versão
              </button>
              <button className="btn secondary" onClick={exportEssay}>
                Exportar redação
              </button>
            </div>
            <textarea
              spellCheck={false}
              placeholder="Escreva sua redação aqui…"
              value={essayText}
              onChange={(e) => setEssayText(e.target.value)}
              onBlur={() => commit()}
            />
          </div>
        ) : needRecall ? (
          <div className="activeRecall">
            <span className="pill">recuperação ativa</span>
            <h2 style={{ marginTop: 12 }}>Antes de ver as alternativas</h2>
            <MathContent
              className="context"
              html={richText(q.context || q.alternativesIntroduction || "Relembre como resolver esta questão.")}
            />
            <p className="muted">
              Tente lembrar do caminho de resolução. Quando estiver pronto, revele as
              alternativas.
            </p>
            <button className="btn" onClick={reveal}>
              Revelar alternativas
            </button>
          </div>
        ) : (
          <div id="questionContent">
            <div className="questionTop">
              <div>
                <div className="qTitle">
                  Questão {q.index} • ENEM {q.year}
                </div>
                <div className="qArea">
                  {AREA_LABELS[discipline(q)] || discipline(q)} • {content}
                  {q.language ? ` • ${q.language}` : ""}
                </div>
              </div>
              <span className="pill">
                {current + 1}/{qs.length}
              </span>
            </div>

            {q.context && <MathContent className="context" html={richText(q.context)} />}
            {files.length > 0 && (
              <div className="qImages">
                {files.map((f) => {
                  const u = safeUrl(f);
                  return u ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="Imagem da questão" />
                  ) : null;
                })}
              </div>
            )}
            {q.alternativesIntroduction && (
              <MathContent className="intro" html={richText(q.alternativesIntroduction)} />
            )}

            <div className="answers">
              {(q.alternatives || []).map((alt) => {
                const L = alt.letter || "";
                const sel = selected === L;
                const af = safeUrl(alt.file || "");
                return (
                  <button
                    key={L}
                    className={`answer ${sel ? "selected" : ""}`}
                    onClick={() => answer(L)}
                  >
                    <span className="letter">{L}</span>
                    <span className="altText">
                      <MathContent html={richText(alt.text || "")} />
                      {af && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="altImg" src={af} alt={`Imagem alternativa ${L}`} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="sourceLine">
              ENEM {q.year} • conteúdo classificado automaticamente como “{content}”.
            </div>
          </div>
        )}
      </div>

      <aside className="card sidebar">
        <div className="row between">
          <div>
            <div className="muted" style={{ fontSize: 11 }}>
              TEMPO
            </div>
            <div className="timer" style={{ color: left === 0 ? "var(--bad)" : undefined }}>
              {fmtSec(left)}
            </div>
          </div>
          {!attempt.strict && (
            <button
              className="btn secondary"
              onClick={() => {
                commitQTime();
                commit();
                router.push("/history");
              }}
            >
              Salvar e sair
            </button>
          )}
        </div>
        <div className="infoLine" style={{ marginTop: 7 }}>
          <span className="badge2">
            {attempt.realDay ? `ENEM Real • Dia ${attempt.realDay}` : attempt.mode}
          </span>
          {attempt.strict && <span className="badge2 strictBadge">modo rígido</span>}
        </div>
        <div className="progress" style={{ margin: "12px 0" }}>
          <span style={{ width: `${(answeredCount / qs.length) * 100}%` }} />
        </div>
        {paceMsg && <div className="paceAlert">{paceMsg}</div>}

        {attempt.strategy && (
          <div className="strategyBox">
            <div className="row between">
              <b style={{ fontSize: 12 }}>Estratégia em passagens</b>
              <span className="badge2">{pass}ª passagem</span>
            </div>
            <div className="passButtons" style={{ marginTop: 7 }}>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  className={pass === n ? "active" : ""}
                  onClick={() => setPass(n)}
                >
                  {n}ª
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="row between" style={{ fontSize: 12, color: "var(--muted)" }}>
          <span>
            {answeredCount}/{qs.length} respondidas
          </span>
          <span>{flaggedCount} marcadas</span>
        </div>

        <div style={{ marginTop: 15 }}>
          <label>Confiança</label>
          <div className="conf">
            {(
              [
                ["certeza", "✓ certeza"],
                ["duvida", "~ dúvida"],
                ["chute", "? chute"],
              ] as const
            ).map(([v, lbl]) => (
              <button
                key={v}
                className={confidence[k] === v ? "selected" : ""}
                onClick={() => setConf(v)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="row between" style={{ marginTop: 12 }}>
          <button className="btn secondary" onClick={() => goto(current - 1)}>
            ←
          </button>
          <button className="btn ghost" onClick={toggleFlag}>
            {flags[k] ? "★ marcada" : "☆ revisar"}
          </button>
          <button className="btn secondary" onClick={() => goto(current + 1)}>
            →
          </button>
        </div>

        <div className="row" style={{ marginTop: 8, gap: 6 }}>
          <button
            className="btn secondary"
            style={{ flex: 1, fontSize: 11, padding: "8px 6px" }}
            onClick={nextUnanswered}
            disabled={answeredCount >= qs.length}
          >
            Próxima em branco →
          </button>
          {flaggedCount > 0 && (
            <button
              className="btn secondary"
              style={{ flex: 1, fontSize: 11, padding: "8px 6px" }}
              onClick={nextFlagged}
            >
              Próxima marcada →
            </button>
          )}
        </div>

        <div className="qgrid">
          {qs.map((qq, i) => {
            const kk = questionKey(qq);
            const cls = [
              answers[kk] ? "answered" : "",
              flags[kk] ? "flagged" : "",
              i === current && !essayMode ? "current" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button key={kk} className={cls} onClick={() => goto(i)}>
                {qq.index}
              </button>
            );
          })}
        </div>

        <div className="muted" style={{ fontSize: 10, marginTop: 8, lineHeight: 1.5 }}>
          Atalhos: <b>A–E</b> responder · <b>← →</b> navegar · <b>1/2/3</b> confiança
        </div>

        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "15px 0" }} />
        <div className="muted" style={{ fontSize: 11, marginBottom: 9 }}>
          {essayMode ? "redação em andamento" : `${shortSec(qSec)} nesta questão`}
        </div>
        {attempt.essay && (
          <button
            className="btn secondary"
            style={{ width: "100%", marginBottom: 8 }}
            onClick={() => {
              commitQTime();
              setEssayMode(true);
            }}
          >
            ✍ Redação
          </button>
        )}
        <button className="btn" style={{ width: "100%" }} onClick={finish}>
          Finalizar e corrigir
        </button>
      </aside>
    </section>
  );
}
