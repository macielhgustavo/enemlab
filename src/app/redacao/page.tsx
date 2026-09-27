"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Clock3, FilePenLine, History, Plus, Target } from "lucide-react";
import { PageHeader } from "@/components/enem-lab/PageHeader";
import { LoadingState } from "@/components/enem-lab/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createEssayPractice,
  essayCompetencyProgress,
  essayPractices,
  ESSAY_COMPETENCIES,
  ESSAY_THEME_LIBRARY,
  nextEssayAction,
} from "@/lib/domain/essay-study";
import { shortSec } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";
import { getProvider, listProviders, resolveProviderId } from "@/lib/providers";
import { examLabel } from "@/lib/providers/label";
import { useStore } from "@/lib/store";

function sourceLabel(source: "project" | "official-reference" | "external") {
  if (source === "project") return "tema próprio";
  if (source === "official-reference") return "referência oficial";
  return "tema externo/manual";
}

export default function EssayHubPage() {
  const hydrated = useHydrated();
  const db = useStore((state) => state.db);
  const mutate = useStore((state) => state.mutate);
  const router = useRouter();
  const [providerDraft, setProviderDraft] = useState<string | null>(null);
  const [timeLimit, setTimeLimit] = useState("90");
  const [customTheme, setCustomTheme] = useState("");

  if (!hydrated) {
    return (
      <Card>
        <LoadingState lines={5} label="Carregando redações" />
      </Card>
    );
  }

  const active = resolveProviderId(db.activeProvider);
  const essayProviders = listProviders().filter((provider) => provider.metadata.hasEssay);
  const fallbackProvider = getProvider(active).metadata.hasEssay ? active : "enem";
  const providerId = providerDraft ?? fallbackProvider;
  const history = essayPractices(db, providerId);
  const metrics = providerId === "enem" ? essayCompetencyProgress(db, providerId) : [];
  const next = nextEssayAction(db, providerId);
  const library = ESSAY_THEME_LIBRARY.filter(
    (theme) => providerId === "enem" || theme.source !== "official-reference",
  );

  function startEssay(input: {
    theme: string;
    themeId?: string | null;
    source: "project" | "official-reference" | "external";
  }) {
    const essay = createEssayPractice({
      providerId,
      theme: input.theme,
      themeId: input.themeId,
      themeSource: input.source,
      timeLimitMin: timeLimit === "none" ? null : Number(timeLimit),
    });
    mutate((current) => {
      (current.essays ||= []).unshift(essay);
    });
    router.push(`/redacao/${essay.id}`);
  }

  const nextHref = next.kind === "review" ? `/redacao/${next.essayId}` : null;

  return (
    <div className="el-essay-hub">
      <PageHeader
        eyebrow="Módulo · redação"
        title="Treino de redação"
        description="Escreva, salve versões e acompanhe avaliações registradas. O Studium não gera nota oficial nem substitui correção humana."
        context={<Badge variant="accent">{examLabel(providerId)}</Badge>}
        actions={
          <select
            aria-label="Prova da redação"
            value={providerId}
            onChange={(event) => setProviderDraft(event.target.value)}
          >
            {essayProviders.map((provider) => (
              <option value={provider.id} key={provider.id}>
                {provider.metadata.shortLabel}
              </option>
            ))}
          </select>
        }
      />

      <div className="el-essay-hub__top">
        <Card className="el-essay-next" variant="raised">
          <div className="el-essay-section-head">
            <Target size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">PRÓXIMA AÇÃO</span>
              <h2>{next.title}</h2>
            </div>
          </div>
          <p className="muted">{next.reason}</p>
          {nextHref ? (
            <Button asChild variant="primary" size="sm">
              <Link href={nextHref}>
                Abrir redação <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </Card>

        <Card>
          <div className="el-essay-section-head">
            <Clock3 size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">SESSÃO</span>
              <h2>Tempo opcional</h2>
            </div>
          </div>
          <label className="el-essay-field" htmlFor="essay-time-limit">
            <span>Limite para novas redações</span>
            <select
              id="essay-time-limit"
              value={timeLimit}
              onChange={(event) => setTimeLimit(event.target.value)}
            >
              <option value="none">Sem limite</option>
              <option value="60">60 minutos</option>
              <option value="90">90 minutos</option>
              <option value="120">120 minutos</option>
            </select>
          </label>
          <p className="muted body-sm">
            O tempo é uma ferramenta de treino. Ele não altera nem estima uma nota.
          </p>
        </Card>
      </div>

      {providerId === "enem" ? (
        <Card>
          <div className="el-essay-section-head">
            <Target size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">COMPETÊNCIAS DO ENEM</span>
              <h2>Evolução baseada apenas nas avaliações registradas</h2>
            </div>
          </div>
          <div className="el-essay-competencies">
            {metrics.map((metric) => (
              <div key={metric.id}>
                <span>{metric.id.toUpperCase()}</span>
                <strong>{metric.average === null ? "—" : `${metric.average}/200`}</strong>
                <small>
                  {metric.samples
                    ? `${metric.samples} avaliação(ões)`
                    : "sem avaliação registrada"}
                </small>
              </div>
            ))}
          </div>
          <p className="caption muted">
            Estas médias refletem autoavaliações e feedbacks manuais cadastrados. Não são nota oficial do ENEM.
          </p>
        </Card>
      ) : null}

      <section className="el-essay-library">
        <div className="el-essay-library__head">
          <div>
            <span className="eyebrow">BIBLIOTECA</span>
            <h2>Escolha um tema</h2>
          </div>
          <span className="caption muted">{library.length} temas disponíveis</span>
        </div>
        <div className="el-essay-theme-grid">
          {library.map((theme) => (
            <Card key={theme.id} variant="interactive">
              <Badge variant={theme.source === "project" ? "accent" : "outline"}>
                {sourceLabel(theme.source)}
              </Badge>
              <h3>{theme.title}</h3>
              <span className="caption muted">{theme.sourceLabel}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  startEssay({
                    theme: theme.title,
                    themeId: theme.id,
                    source: theme.source,
                  })
                }
              >
                Começar <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </Card>
          ))}
        </div>

        <Card className="el-essay-custom">
          <div className="el-essay-section-head">
            <Plus size={18} aria-hidden="true" />
            <div>
              <span className="eyebrow">TEMA EXTERNO OU PRÓPRIO</span>
              <h2>Adicionar outro tema</h2>
            </div>
          </div>
          <div className="el-essay-custom__row">
            <input
              aria-label="Tema personalizado"
              value={customTheme}
              onChange={(event) => setCustomTheme(event.target.value)}
              placeholder="Digite apenas o tema que você vai desenvolver"
            />
            <Button
              variant="primary"
              disabled={!customTheme.trim()}
              onClick={() =>
                startEssay({
                  theme: customTheme,
                  source: "external",
                })
              }
            >
              Criar redação
            </Button>
          </div>
        </Card>
      </section>

      <section className="el-essay-history">
        <div className="el-essay-library__head">
          <div>
            <span className="eyebrow">HISTÓRICO</span>
            <h2>Redações registradas</h2>
          </div>
          <History size={18} aria-hidden="true" />
        </div>

        {history.length ? (
          <div className="el-essay-history__list">
            {history.map((essay) => {
              const latestEvaluation = essay.evaluations?.[essay.evaluations.length - 1];
              return (
                <Card key={essay.id} padding="sm" className="el-essay-history__item">
                  <div>
                    <div className="el-essay-history__badges">
                      <Badge variant={essay.finishedAt ? "success" : "warning"}>
                        {essay.finishedAt ? "concluída" : "em andamento"}
                      </Badge>
                      <Badge variant="outline">{sourceLabel(essay.themeSource)}</Badge>
                    </div>
                    <strong>{essay.theme}</strong>
                    <span className="caption muted">
                      {new Date(essay.startedAt).toLocaleDateString("pt-BR")} ·{" "}
                      {shortSec(essay.elapsedSec)} · {essay.versions?.length || 0} versão(ões)
                    </span>
                  </div>
                  <div className="el-essay-history__evaluation">
                    {latestEvaluation ? (
                      <>
                        <span className="caption">Última avaliação</span>
                        <strong>{latestEvaluation.authorLabel}</strong>
                        <small className="muted">
                          {latestEvaluation.source === "self"
                            ? "autoavaliação"
                            : "feedback externo/manual"}
                        </small>
                      </>
                    ) : (
                      <span className="muted body-sm">Sem avaliação registrada</span>
                    )}
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/redacao/${essay.id}`}>
                      {essay.finishedAt ? "Abrir histórico" : "Continuar"}{" "}
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </Button>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="el-essay-empty">
            <FilePenLine size={20} aria-hidden="true" />
            <div>
              <strong>Nenhuma redação independente ainda.</strong>
              <span className="muted">Escolha um tema acima para iniciar o histórico.</span>
            </div>
          </Card>
        )}
      </section>

      {providerId === "enem" ? (
        <details className="el-essay-competency-help">
          <summary>O que cada competência representa?</summary>
          <div>
            {ESSAY_COMPETENCIES.map((competency) => (
              <p key={competency.id}>
                <strong>{competency.short}</strong> · {competency.label}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
