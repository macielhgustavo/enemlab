"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Layers3,
  LineChart,
  RefreshCcw,
  Target,
} from "lucide-react";
import { useReveal } from "@/hooks/use-reveal";

const cycle = ["Treinar", "Medir", "Entender", "Revisar", "Dominar"];
const exams = ["ENEM", "ITA", "IME", "FUVEST", "AFA", "EPCAR"];
const errorBarHeights = [
  "h-[30%]", "h-[48%]", "h-[38%]", "h-[72%]", "h-[52%]", "h-[83%]",
  "h-[45%]", "h-[60%]", "h-[35%]", "h-1/2", "h-[29%]", "h-[22%]",
];

const features = [
  [Database, "Banco de questões", "Encontre o treino certo por prova, área, tema e nível de domínio."],
  [BrainCircuit, "Plano adaptativo", "Uma sequência de estudo que responde ao seu desempenho real."],
  [RefreshCcw, "Revisões", "Conteúdo retorna no momento certo, com foco no que ainda precisa consolidar."],
  [Target, "Domínio", "Visualize o que já está sólido e onde concentrar sua energia."],
  [Clock3, "Histórico", "Cada tentativa vira contexto para decisões melhores."],
  [BarChart3, "Dados", "Leia padrões de acerto, tempo e recorrência de erros sem ruído."],
] as const;

const analyticsRows = [
  [LineChart, "Evolução", "Acompanhe tendências ao longo do tempo."],
  [Target, "Erros", "Identifique padrões, não apenas respostas."],
  [RefreshCcw, "Revisão", "Priorize o que exige nova tentativa."],
] as const;

function ActionLink({
  href,
  children,
  variant = "quiet",
  size = "lg",
}: {
  href: string;
  children: ReactNode;
  variant?: "premium" | "quiet";
  size?: "sm" | "lg";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[transform,box-shadow,background-color,border-color,color] duration-500 ease-[var(--ease-premium)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 [&_svg]:size-4 [&_svg]:shrink-0 hover:[&_svg]:translate-x-0.5";
  const appearance =
    variant === "premium"
      ? "bg-brand text-[#04120d] shadow-[var(--landing-shadow-action)] hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[var(--landing-shadow-action-hover)]"
      : "border border-line bg-[color-mix(in_oklab,var(--surface-3)_60%,transparent)] text-text backdrop-blur-sm hover:-translate-y-0.5 hover:border-brand/40 hover:bg-[var(--surface-3)]";
  const dimensions = size === "sm" ? "h-8 px-3 text-xs" : "h-12 px-6 text-sm";

  return (
    <a href={href} className={`${base} ${appearance} ${dimensions}`}>
      {children}
    </a>
  );
}

function BrandMark() {
  return (
    <a
      href="#top"
      className="group flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
      aria-label="Studium Labs, início"
    >
      <span
        className="grid size-8 shrink-0 grid-cols-2 gap-1 rounded-sm border border-brand/25 bg-brand/10 p-1.5 transition-all duration-500 ease-[var(--ease-premium)] group-hover:border-brand/50 group-hover:bg-brand/15"
        aria-hidden="true"
      >
        <span className="bg-brand transition-opacity duration-500 group-hover:opacity-70" />
        <span className="bg-[color-mix(in_oklab,var(--cyan)_45%,transparent)]" />
        <span className="bg-[color-mix(in_oklab,var(--cyan)_45%,transparent)]" />
        <span className="bg-brand transition-opacity duration-500 group-hover:opacity-70" />
      </span>
      <span className="text-sm font-semibold tracking-[-0.01em]">
        STUDIUM <span className="text-brand">LABS</span>
      </span>
    </a>
  );
}

function AppMockup() {
  return (
    <div className="landing-reveal landing-panel-shadow relative mx-auto mt-20 max-w-5xl overflow-hidden rounded-xl border border-line landing-surface-gradient text-left [--d:5] md:mt-24">
      <div className="flex h-12 items-center justify-between border-b border-line bg-[var(--surface-3)]/50 px-5">
        <div className="flex gap-1.5">
          <span className="size-2 rounded-full bg-[color-mix(in_oklab,var(--text-faint)_50%,transparent)]" />
          <span className="size-2 rounded-full bg-[color-mix(in_oklab,var(--text-faint)_50%,transparent)]" />
          <span className="size-2 rounded-full bg-[color-mix(in_oklab,var(--text-faint)_50%,transparent)]" />
        </div>
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted">
          PAINEL / VISÃO GERAL
        </span>
        <span className="landing-signal-pulse size-2 rounded-full bg-brand" />
      </div>

      <div className="grid min-h-[400px] grid-cols-1 md:grid-cols-[184px_1fr]">
        <aside className="hidden border-r border-line p-4 md:block">
          <div className="mb-6 h-8 rounded-sm border border-brand/20 bg-brand/8" />
          {["Visão geral", "Treinos", "Plano", "Revisões", "Desempenho"].map((item, i) => (
            <div
              key={item}
              className={`mb-1 flex h-9 items-center gap-2 rounded-sm px-3 text-xs transition-colors duration-500 ${
                i === 0 ? "bg-[var(--surface-3)] text-text" : "text-muted hover:text-text"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  i === 0
                    ? "bg-brand"
                    : "bg-[color-mix(in_oklab,var(--text-faint)_50%,transparent)]"
                }`}
              />
              {item}
            </div>
          ))}
        </aside>

        <div className="p-6 md:p-8">
          <div className="mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.16em] text-brand">CICLO ATIVO</p>
              <h3 className="mt-2 truncate text-xl font-semibold">Seu desempenho</h3>
            </div>
            <span className="hidden rounded-full border border-line px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-muted sm:inline">
              ÚLTIMOS 30 DIAS
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="landing-soft-shadow rounded-lg border border-line bg-bg/40 p-6">
              <div className="mb-8 flex items-center justify-between">
                <span className="text-xs text-muted">Evolução de domínio</span>
                <LineChart className="size-4 text-brand" />
              </div>
              <svg
                viewBox="0 0 560 150"
                className="h-40 w-full overflow-visible"
                role="img"
                aria-label="Gráfico ilustrativo de evolução de domínio"
              >
                <defs>
                  <linearGradient id="areaFade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0 130 C55 126 75 100 125 105 S190 80 240 88 S320 48 370 60 S450 25 560 18 L560 150 L0 150 Z"
                  className="text-brand"
                  fill="url(#areaFade)"
                />
                <path
                  d="M0 130 C55 126 75 100 125 105 S190 80 240 88 S320 48 370 60 S450 25 560 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="text-brand"
                />
                {[130, 105, 88, 60, 18].map((y, i) => (
                  <circle
                    key={y}
                    cx={i * 135 + 5}
                    cy={y}
                    r="4"
                    className="fill-[var(--bg)] stroke-[var(--brand)]"
                    strokeWidth="2"
                  />
                ))}
              </svg>
              <div className="mt-3 flex justify-between font-mono text-[9px] tracking-[0.14em] text-[var(--text-faint)]">
                <span>SEM 01</span>
                <span>SEM 04</span>
                <span>SEM 08</span>
                <span>AGORA</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="landing-soft-shadow rounded-lg border border-line bg-bg/40 p-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">Próxima ação</span>
                  <Target className="size-4 text-[var(--cyan)]" />
                </div>
                <p className="mt-6 text-sm font-semibold">Revisão direcionada</p>
                <p className="mt-1 text-xs text-muted">Eletrodinâmica · Bloco 03</p>
                <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div className="h-full w-3/5 rounded-full bg-[var(--cyan)]" />
                </div>
              </div>
              <div className="landing-soft-shadow rounded-lg border border-line bg-bg/40 p-6">
                <span className="text-xs text-muted">Consistência por área</span>
                <div className="mt-6 space-y-4">
                  {[["Matemática", "w-4/5"], ["Natureza", "w-2/3"], ["Linguagens", "w-1/2"]].map(
                    ([label, w]) => (
                      <div
                        key={label}
                        className="grid grid-cols-[84px_1fr] items-center gap-3 text-[10px] text-muted"
                      >
                        <span className="truncate">{label}</span>
                        <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                          <div className={`h-full rounded-full bg-brand/70 ${w}`} />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="max-w-2xl">
      <p
        className="landing-reveal-on-scroll font-mono text-[11px] uppercase tracking-[0.18em] text-brand"
        data-reveal
      >
        {eyebrow}
      </p>
      <h2
        className="landing-reveal-on-scroll mt-5 text-[clamp(2rem,4.2vw,3.25rem)] font-semibold leading-[1.06] [--d:1]"
        data-reveal
      >
        {title}
      </h2>
      <p
        className="landing-reveal-on-scroll mt-6 max-w-xl text-base leading-[1.75] text-muted [--d:2]"
        data-reveal
      >
        {text}
      </p>
    </div>
  );
}

export default function LandingPage() {
  useReveal();

  return (
    <main id="top" className="landing-page min-h-screen bg-bg text-text">
      <div className="landing-technical-grid pointer-events-none absolute inset-x-0 top-0 h-[860px] opacity-45" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[700px] bg-[radial-gradient(70%_50%_at_50%_0%,color-mix(in_oklab,var(--brand)_10%,transparent),transparent_70%)]" />

      <nav className="landing-glass sticky top-0 z-30 w-full" aria-label="Navegação principal">
        <div className="mx-auto grid h-16 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-6 md:h-20 md:grid-cols-[1fr_auto_1fr] md:px-8">
          <BrandMark />
          <div className="hidden items-center gap-9 text-xs text-muted md:flex">
            {[["#plataforma", "Plataforma"], ["#metodo", "Método"], ["#dados", "Dados"]].map(
              ([href, label]) => (
                <a
                  key={href}
                  className="relative py-1 transition-colors duration-500 ease-[var(--ease-premium)] after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-right after:scale-x-0 after:bg-brand after:transition-transform after:duration-500 after:ease-[var(--ease-premium)] hover:text-text hover:after:origin-left hover:after:scale-x-100"
                  href={href}
                >
                  {label}
                </a>
              ),
            )}
          </div>
          <div className="flex justify-end">
            <ActionLink href="/login" variant="quiet" size="sm">
              Acessar plataforma <ArrowRight />
            </ActionLink>
          </div>
        </div>
      </nav>

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-32 pt-24 text-center md:px-8 md:pt-32">
        <div className="landing-reveal mx-auto inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/5 px-4 py-1.5 font-mono text-[10px] tracking-[0.16em] text-brand">
          <span className="landing-signal-pulse size-1.5 rounded-full bg-brand" />
          PERFORMANCE ACADÊMICA, REDEFINIDA
        </div>

        <h1 className="landing-reveal mx-auto mt-10 max-w-5xl text-[clamp(2.75rem,7.4vw,5.6rem)] font-semibold leading-[1.02] [--d:1]">
          Transforme preparação
          <br className="hidden sm:block" /> em <span className="landing-text-accent-gradient">sistema.</span>
        </h1>

        <p className="landing-reveal mx-auto mt-8 max-w-2xl text-base leading-[1.75] text-muted [--d:2] md:text-lg">
          Treine com intenção, analise cada sinal e domine as provas que importam. Uma plataforma
          criada para transformar esforço em progresso mensurável.
        </p>

        <div className="landing-reveal mt-10 flex flex-col justify-center gap-3 [--d:3] sm:flex-row">
          <ActionLink href="/login" variant="premium" size="lg">
            Começar a treinar <ArrowRight />
          </ActionLink>
          <ActionLink href="#plataforma" variant="quiet" size="lg">
            Explorar plataforma <ChevronRight />
          </ActionLink>
        </div>

        <AppMockup />
      </section>

      <section id="metodo" className="relative border-y border-line bg-[var(--surface-1)]/50 py-14">
        <div className="mx-auto max-w-7xl px-6 md:px-8">
          <p
            className="landing-reveal-on-scroll mb-8 font-mono text-[10px] tracking-[0.18em] text-muted"
            data-reveal
          >
            UM CICLO CONTÍNUO DE MELHORIA
          </p>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-5">
            {cycle.map((item, i) => (
              <div
                key={item}
                className="landing-reveal-on-scroll group flex items-center justify-between bg-bg px-5 py-6 transition-colors duration-500 ease-[var(--ease-premium)] hover:bg-[var(--surface-3)]/60"
                style={{ "--d": i } as CSSProperties}
                data-reveal
              >
                <span className="font-mono text-[10px] text-[var(--text-faint)]">0{i + 1}</span>
                <span className="text-sm font-medium">{item}</span>
                {i < cycle.length - 1 ? (
                  <ArrowRight className="size-3.5 text-brand transition-transform duration-500 ease-[var(--ease-premium)] group-hover:translate-x-0.5" />
                ) : (
                  <Check className="size-3.5 text-brand" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="plataforma" className="mx-auto max-w-7xl px-6 py-28 md:px-8 md:py-40">
        <SectionHeading
          eyebrow="Plataforma integrada"
          title="Tudo conversa. Nada se perde."
          text="Cada treino alimenta o próximo passo. Questões, revisões e desempenho conectados em uma única lógica de preparação."
        />
        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
          {features.map(([Icon, title, text], i) => (
            <article
              key={title}
              className="landing-reveal-on-scroll group relative min-h-64 bg-[var(--surface-1)] p-8 transition-colors duration-500 ease-[var(--ease-premium)] hover:bg-[var(--surface-3)]"
              style={{ "--d": i } as CSSProperties}
              data-reveal
            >
              <span className="grid size-10 place-items-center rounded-md border border-line bg-bg/50 transition-colors duration-500 ease-[var(--ease-premium)] group-hover:border-brand/40">
                <Icon className="size-4.5 text-brand" />
              </span>
              <h3 className="mt-14 text-lg font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-[1.7] text-muted">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-[var(--surface-1)] py-24 md:py-32">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 md:grid-cols-[0.8fr_1.2fr] md:items-center md:px-8">
          <SectionHeading
            eyebrow="Multi-exam"
            title="Uma base. Diferentes desafios."
            text="Organize a preparação para provas com perfis distintos sem fragmentar seu método. A estratégia muda; o sistema permanece."
          />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            {exams.map((exam, i) => (
              <div
                key={exam}
                className="landing-reveal-on-scroll flex aspect-[1.4] flex-col justify-between bg-bg p-5 transition-colors duration-500 ease-[var(--ease-premium)] hover:bg-[var(--surface-3)]"
                style={{ "--d": i } as CSSProperties}
                data-reveal
              >
                <span className="font-mono text-[9px] text-[var(--text-faint)]">0{i + 1}</span>
                <span className="text-base font-semibold tracking-[-0.01em]">{exam}</span>
              </div>
            ))}
            <div
              className="landing-reveal-on-scroll col-span-2 flex min-h-28 items-end bg-bg p-5 text-sm text-muted [--d:6]"
              data-reveal
            >
              + vestibulares de todo o Brasil
            </div>
          </div>
        </div>
      </section>

      <section id="dados" className="mx-auto max-w-7xl px-6 py-28 md:px-8 md:py-40">
        <div className="grid gap-16 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <SectionHeading
              eyebrow="Analytics acionável"
              title="Dados que dizem o que fazer depois."
              text="Menos métricas decorativas. Mais clareza sobre domínio, evolução, erros recorrentes e revisões necessárias."
            />
            <div className="mt-12 space-y-5">
              {analyticsRows.map(([Icon, title, text], i) => (
                <div
                  key={title}
                  className="landing-reveal-on-scroll flex gap-4 border-t border-line pt-5"
                  style={{ "--d": i + 3 } as CSSProperties}
                  data-reveal
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-brand" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-1.5 text-xs leading-[1.7] text-muted">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            className="landing-reveal-on-scroll landing-panel-shadow overflow-hidden rounded-xl border border-line landing-surface-gradient"
            data-reveal
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <span className="text-sm font-medium">Mapa de domínio</span>
              <span className="font-mono text-[9px] tracking-[0.14em] text-brand">ATUALIZADO AGORA</span>
            </div>
            <div className="p-6 md:p-8">
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Álgebra", "Consolidando", "w-4/5"],
                  ["Mecânica", "Em progresso", "w-3/5"],
                  ["Química geral", "Revisar", "w-2/5"],
                  ["Interpretação", "Consistente", "w-[88%]"],
                ].map(([name, status, width]) => (
                  <div
                    key={name}
                    className="landing-lift landing-soft-shadow rounded-lg border border-line bg-bg/40 p-5 hover:border-brand/30"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <span className="truncate text-sm font-medium">{name}</span>
                      <span className="font-mono text-[9px] text-muted">{status}</span>
                    </div>
                    <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div className={`h-full rounded-full bg-brand ${width}`} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="landing-soft-shadow mt-4 rounded-lg border border-line bg-bg/40 p-6">
                <div className="mb-8 flex items-center justify-between">
                  <span className="text-sm font-medium">Padrão de erros</span>
                  <Layers3 className="size-4 text-[var(--cyan)]" />
                </div>
                <div className="grid h-40 grid-cols-12 items-end gap-2">
                  {errorBarHeights.map((height, i) => (
                    <div
                      key={`${height}-${i}`}
                      className="flex h-full items-end rounded-sm bg-[var(--surface-3)]/35"
                    >
                      <div
                        className={`w-full rounded-sm bg-[color-mix(in_oklab,var(--cyan)_60%,transparent)] transition-all duration-700 ease-[var(--ease-premium)] hover:bg-[var(--cyan)] ${height}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-between font-mono text-[9px] tracking-[0.14em] text-[var(--text-faint)]">
                  <span>CONCEITO</span>
                  <span>INTERPRETAÇÃO</span>
                  <span>TEMPO</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="final"
        className="landing-hairline-top relative border-t border-line px-6 py-32 text-center md:px-8 md:py-40"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_100%,color-mix(in_oklab,var(--brand)_9%,transparent),transparent_70%)]" />
        <div className="relative mx-auto max-w-3xl">
          <BookOpen className="landing-reveal-on-scroll mx-auto size-6 text-brand" data-reveal />
          <h2
            className="landing-reveal-on-scroll mt-8 text-[clamp(2.25rem,5.4vw,4rem)] font-semibold leading-[1.05] [--d:1]"
            data-reveal
          >
            Construa um sistema para chegar mais preparado.
          </h2>
          <p
            className="landing-reveal-on-scroll mx-auto mt-6 max-w-xl leading-[1.75] text-muted [--d:2]"
            data-reveal
          >
            Sua preparação deixa de ser uma sequência de tarefas e passa a operar como um processo
            inteligente.
          </p>
          <div className="landing-reveal-on-scroll mt-10 [--d:3]" data-reveal>
            <ActionLink href="/login" variant="premium" size="lg">
              Acessar plataforma <ArrowRight />
            </ActionLink>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <BrandMark />
          <p className="font-mono text-[10px] tracking-[0.14em] text-muted">
            PREPARAÇÃO ORIENTADA POR SISTEMA.
          </p>
          <a href="#top" className="text-xs text-muted transition-colors duration-500 hover:text-text">
            Voltar ao topo ↑
          </a>
        </div>
      </footer>
    </main>
  );
}
