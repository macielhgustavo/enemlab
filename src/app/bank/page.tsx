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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import {
  FilterBar,
  FilterChip,
  FilterGroup,
  QuestionStatusBadge,
  type QuestionStatus,
} from "@/components/enem-lab/FilterBar";
import { EmptyState, ErrorState, LoadingState } from "@/components/enem-lab/states";
import { areaLabel, areasOf } from "@/lib/providers/taxonomy";
import { buildCurrentCatalog } from "@/lib/catalog/current";
import { examLabel, phaseLabel } from "@/lib/providers/label";
import { useToast } from "@/components/Toast";
import type { DB, Question } from "@/lib/domain/types";

/** Tira imagem markdown do trecho: a lista mostrava a URL crua como texto. */
function trecho(texto: string): string {
  return texto
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bankStatus(db: DB, q: Question): QuestionStatus {
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
  const [editionId, setEditionId] = useState("");
  const [subject, setSubject] = useState("all");
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("all");
  const [status, setStatus] = useState("all");
  const [diff, setDiff] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /**
   * O índice responde antes de qualquer questão ser carregada (§29, §30).
   *
   * Antes, para saber quais anos existem e quantas questões havia, o Banco
   * precisava baixar a edição inteira. Com três provas isso ainda passava;
   * com dezenas, montar um filtro viraria download de megabytes.
   *
   * O índice é uma linha por edição, não por questão.
   */
  const catalogo = useMemo(() => buildCurrentCatalog(), []);
  const anosDisponiveis = catalogo.yearsOf(providerId);
  const provider = getProvider(providerId);
  const namedEditions = provider.metadata.editions ?? [];
  const activeNamedEdition = namedEditions.find((edition) => edition.id === editionId)
    ?? namedEditions[0];
  const selectedYear = isIta ? itaYear : year;
  const activeYear = activeNamedEdition?.year ?? (anosDisponiveis.includes(selectedYear)
    ? selectedYear
    : (anosDisponiveis[0] ?? selectedYear));
  const providerAreas = areasOf(providerId);
  const itaSubjectIds = Object.keys(itaAnswerKey(activeYear)?.subjects ?? {});
  const activeSubject = isIta && itaSubjectIds.includes(subject) ? subject : "all";
  const activeArea = !isIta && providerAreas.some(({ id }) => id === area) ? area : "all";
  const activeLanguage = provider.metadata.languages[0]?.id ?? "ingles";
  const totalNoCatalogo = catalogo.countQuestions({ providerId });
  const edicoesNoCatalogo = catalogo.query({
    providerId,
    year: activeYear,
    editionId: activeNamedEdition?.id,
  });
  const questoesNaEdicao = edicoesNoCatalogo.reduce(
    (total, edition) => total + (edition.questionCount ?? 0),
    0,
  );

  const {
    data: questions,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["exam", providerId, activeYear, activeNamedEdition?.id, activeLanguage],
    queryFn: () => questionsFor(providerId, {
      year: activeYear,
      editionId: activeNamedEdition?.id,
      language: activeLanguage as "ingles" | "espanhol",
    }),
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
          (activeArea === "all" || discipline(q) === activeArea) &&
          (activeSubject === "all" || discipline(q) === activeSubject) &&
          (status === "all" || bankStatus(db, q) === status) &&
          (diff === "all" || d === diff)
        );
      })
      .slice(0, 250);
  }, [questions, query, activeArea, activeSubject, status, diff, db]);

  const selectedActiveCount = useMemo(() => {
    if (!questions) return 0;
    return questions.reduce((count, q) => count + (selected.has(questionKey(q)) ? 1 : 0), 0);
  }, [questions, selected]);

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
    const a = attemptFromQuestions(qs[0].year, activeLanguage as "ingles" | "espanhol", qs, "bank", providerId);
    addAttempt(a);
    router.push(`/exam/${a.id}`);
  }

  if (!hydrated) return <Card><span className="muted">Carregando…</span></Card>;

  return (
    <>
      <PageHeader
        eyebrow="Módulo · acervo"
        title="Banco de questões"
        context={<Badge variant="accent">{provider.metadata.shortLabel}</Badge>}
        description="Filtre, selecione e monte um treino com as questões que interessam."
        meta={
          <>
            {!isLoading && <span>{visible.length} visíveis</span>}
            {!isLoading && <span>{selectedActiveCount} selecionadas</span>}
            {/* Vem do índice: não custa carregar nenhuma questão. */}
            <span>
              {totalNoCatalogo.known > 0
                ? `${totalNoCatalogo.known} no catálogo`
                : `${anosDisponiveis.length} edições no catálogo`}
            </span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={selectVisible} disabled={!visible.length}>
              Selecionar visíveis
            </Button>
            <Button variant="primary" size="sm" onClick={start} disabled={!selectedActiveCount}>
              Treinar selecionadas
            </Button>
          </>
        }
      />

      <FilterBar
        summary={
          isLoading
            ? // O índice já sabe o tamanho da edição antes de ela chegar.
              questoesNaEdicao
              ? `carregando ${questoesNaEdicao} questões…`
              : "carregando banco…"
            : `${visible.length} de ${(questions || []).length} questões`
        }
        onClear={() => {
          setQuery("");
          setArea("all");
          setSubject("all");
          setStatus("all");
          setDiff("all");
        }}
      >
        <FilterGroup label="Buscar">
          <input
            id="banco-busca"
            className="el-search"
            type="search"
            aria-label="Buscar no enunciado ou conteúdo"
            placeholder="Buscar no enunciado, conteúdo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </FilterGroup>

        <FilterGroup label="Edição">
          {/* Ano continua em select: quinze opções viram uma parede de chips. */}
          <label className="el-visually-hidden" htmlFor="banco-ano">
            Edição da prova
          </label>
          {isIta ? (
            <select
              id="banco-ano"
              className="el-select__trigger"
              value={activeYear}
              onChange={(e) => {
                setItaYear(Number(e.target.value));
                setSelected(new Set());
              }}
            >
              {itaYears().map((y) => (
                <option key={y} value={y}>
                  ITA {y}
                </option>
              ))}
            </select>
          ) : namedEditions.length ? (
            <select
              id="banco-ano"
              className="el-select__trigger"
              value={activeNamedEdition?.id ?? ""}
              onChange={(e) => {
                setEditionId(e.target.value);
                setSelected(new Set());
              }}
            >
              {namedEditions.map((edition) => (
                <option key={edition.id} value={edition.id}>
                  {edition.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              id="banco-ano"
              className="el-select__trigger"
              value={activeYear}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setSelected(new Set());
              }}
            >
              {/* O rótulo vem da prova ativa. Estava fixo em "ENEM" e, com
                  uma terceira prova registrada, o IME passou a listar
                  "ENEM 2026" — o tipo de leak que só aparece quando o
                  segundo caso deixa de ser o único. */}
              {(anosDisponiveis.length ? anosDisponiveis : examYears()).map((y) => (
                <option key={y} value={y}>
                  {examLabel(providerId)} {y}
                </option>
              ))}
            </select>
          )}
        </FilterGroup>

        <FilterGroup label={providerId === "enem" ? "Área" : "Matéria"}>
          <FilterChip
            active={(isIta ? activeSubject : activeArea) === "all"}
            onClick={() => (isIta ? setSubject("all") : setArea("all"))}
          >
            Todas
          </FilterChip>
          {isIta
            ? itaSubjectIds.map((id) => (
                <FilterChip key={id} active={activeSubject === id} onClick={() => setSubject(id)}>
                  {areaLabel(id, providerId)}
                </FilterChip>
              ))
            : providerAreas.map(({ id }) => (
                <FilterChip key={id} active={activeArea === id} onClick={() => setArea(id)}>
                  {areaLabel(id, providerId)}
                </FilterChip>
              ))}
        </FilterGroup>

        <FilterGroup label="Status">
          {[
            ["all", "Todos"],
            ["unseen", "Nunca vi"],
            ["wrong", "Já errei"],
            ["correct", "Já acertei"],
            ["srs", "No SRS"],
          ].map(([v, rotulo]) => (
            <FilterChip key={v} active={status === v} onClick={() => setStatus(v)}>
              {rotulo}
            </FilterChip>
          ))}
        </FilterGroup>

        <FilterGroup label="Dificuldade pessoal">
          {[
            ["all", "Toda"],
            ["facil", "Fácil"],
            ["media", "Média"],
            ["dificil", "Difícil"],
          ].map(([v, rotulo]) => (
            <FilterChip key={v} active={diff === v} onClick={() => setDiff(v)}>
              {rotulo}
            </FilterChip>
          ))}
        </FilterGroup>
      </FilterBar>

      <div className="el-banklist" aria-busy={isLoading || undefined}>
        {isLoading && (
          <>
            {/* Esqueleto com a forma da linha que vem, não um spinner: assim
                a lista não salta de altura quando o banco chega. */}
            <span className="el-visually-hidden">Carregando o banco de questões</span>
            {Array.from({ length: 6 }, (_, i) => (
              <Card key={i} padding="sm" className="el-bankitem">
                <LoadingState lines={2} label="" />
              </Card>
            ))}
          </>
        )}

        {error && (
          <ErrorState
            title="Não foi possível carregar o banco"
            description={(error as Error).message}
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !error && visible.length === 0 && (
          <EmptyState
            title="Nenhuma questão com esses filtros"
            description="Solte um filtro ou troque a edição para ver mais questões."
          />
        )}

        {!isLoading &&
          visible.map((q) => {
            const k = questionKey(q);
            const c = classifyContent(q);
            const d = personalDifficulty(db, q);
            const [dl, dc] = difficultyLabel(d);
            const st = bankStatus(db, q);
            const marcada = selected.has(k);
            const semEnunciado = q.statementAvailable === false;
            return (
              <Card
                key={k}
                padding="sm"
                variant={marcada ? "success" : "default"}
                className="el-bankitem"
              >
                <label className="el-bankitem__pick">
                  <input
                    type="checkbox"
                    checked={marcada}
                    onChange={(e) => toggle(k, e.target.checked)}
                    aria-label={`Selecionar questão ${q.number ?? q.index} de ${examLabel(q.official?.institution ? providerId : providerId)} ${q.year}`}
                  />
                </label>

                <div className="el-bankitem__body">
                  <div className="el-bankitem__title">
                    <b className="heading-sm">Q{q.number ?? q.index}</b>
                    <span className="caption">
                      {q.official?.institution ?? examLabel(providerId)} {q.year}
                    </span>
                  </div>

                  <div className="el-bankitem__path caption">
                    {semEnunciado ? (
                      <>
                        <span>{areaLabel(String(discipline(q)), providerId)}</span>
                        <span>{phaseLabel(q.phase)}</span>
                        <span>objetiva</span>
                      </>
                    ) : (
                      contentPath(c).map((cam) => <span key={cam}>{cam}</span>)
                    )}
                  </div>

                  <p className="body-sm el-bankitem__excerpt">
                    {semEnunciado
                      ? "Enunciado na prova oficial — abra o documento da banca para ler."
                      : trecho(String(q.context || q.alternativesIntroduction || ""))}
                  </p>
                </div>

                <div className="el-bankitem__tags">
                  <Badge variant={dc === "tagEasy" ? "success" : dc === "tagHard" ? "danger" : "warning"}>
                    {dl}
                  </Badge>
                  <QuestionStatusBadge status={st} />
                </div>
              </Card>
            );
          })}
      </div>
    </>
  );
}
