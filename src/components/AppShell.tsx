"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Dumbbell,
  Library,
  Sparkles,
  Map,
  Gauge,
  RotateCcw,
  Clock,
  BookX,
  Database,
  Sun,
  Moon,
  Search,
  UserRound,
  Cloud,
  Menu,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { Sheet, SheetTrigger, SheetContent, SheetClose } from "@/components/ui/sheet";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { dueSRS } from "@/lib/domain/srs";
import { resolveProviderId } from "@/lib/providers";
import { useCloudSync } from "@/components/CloudSyncProvider";
import CommandPalette from "@/components/CommandPalette";
import ProviderSwitcher from "@/components/enem-lab/ProviderSwitcher";
import ImageZoomHost from "@/components/ImageZoomHost";
import QuestionIssueReporter from "@/components/QuestionIssueReporter";
import ExamExperienceHost from "@/components/ExamExperienceHost";

const NAV = [
  { href: "/", label: "Início", icon: Home, short: "Início" },
  { href: "/practice", label: "Treinar", icon: Dumbbell, short: "Treinar" },
  { href: "/bank", label: "Banco", icon: Library, short: "Banco" },
  { href: "/adaptive", label: "Adaptive 2.0", icon: Sparkles, short: "Adaptive" },
  { href: "/plano", label: "Plano", icon: Map, short: "Plano" },
  { href: "/mastery", label: "Domínio", icon: Gauge, short: "Domínio" },
  { href: "/srs", label: "Revisões", icon: RotateCcw, short: "Revisões" },
  { href: "/history", label: "Histórico", icon: Clock, short: "Histórico" },
  { href: "/review", label: "Erros", icon: BookX, short: "Erros" },
  { href: "/data", label: "Dados", icon: Database, short: "Dados" },
  { href: "/account", label: "Conta", icon: UserRound, short: "Conta" },
];

/**
 * A nav era uma lista de onze itens sem hierarquia, e "Conta" ficava no fim
 * dela como se fosse mais uma ferramenta de estudo. Agrupar diz o que é
 * ação, o que é acompanhamento e o que é configuração — e encurta a busca
 * visual de onze itens para três blocos.
 */
const GRUPOS: { titulo: string; itens: typeof NAV }[] = [
  {
    titulo: "Estudar",
    itens: NAV.filter((n) =>
      ["/", "/practice", "/bank", "/adaptive", "/plano"].includes(n.href),
    ),
  },
  {
    titulo: "Acompanhar",
    itens: NAV.filter((n) => ["/mastery", "/srs", "/history", "/review"].includes(n.href)),
  },
  { titulo: "Sistema", itens: NAV.filter((n) => ["/data", "/account"].includes(n.href)) },
];

const MOBILE = [NAV[0], NAV[1], NAV[2], NAV[6]];

function openPalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
  );
}

/**
 * Quanto ar cada tela merece.
 *
 * Não é preferência do usuário: é decisão de projeto. Rota não listada fica
 * no padrão — o default precisa ser o certo para a maioria, senão vira uma
 * tabela que alguém tem que manter.
 */
function densidadeDaRota(pathname: string): "compact" | "default" | "spacious" {
  if (pathname === "/") return "spacious";
  if (pathname.startsWith("/bank") || pathname.startsWith("/srs")) return "compact";
  return "default";
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useStore((s) => s.db.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const db = useStore((s) => s.db);
  const hydrated = useHydrated();
  const cloud = useCloudSync();

  const due = hydrated ? dueSRS(db, resolveProviderId(db.activeProvider)).length : 0;
  const attempts = hydrated ? db.attempts.length : 0;
  const sysClass = !hydrated ? "" : due > 10 ? "bad" : due > 0 ? "warn" : "";
  const sysLabel = !hydrated
    ? "carregando"
    : due > 0
      ? `${due} pendente${due > 1 ? "s" : ""}`
      : "tudo em dia";

  const cloudLabel =
    cloud.status === "syncing"
      ? "sincronizando"
      : cloud.status === "needs-merge"
        ? "mesclar conta"
        : cloud.user
          ? cloud.status === "idle"
            ? "nuvem em dia"
            : "nuvem offline"
          : "somente local";

  const isExam = pathname.startsWith("/exam/");
  const isResultReview = /^\/result\/[^/]+\/review$/.test(pathname);
  const canOpenResultReview = /^\/result\/[^/]+$/.test(pathname);

  if (isExam) {
    return (
      <div className="layout examLayout">
        <main className="content examContent">{children}</main>
        <ImageZoomHost />
        <QuestionIssueReporter />
        <ExamExperienceHost />
      </div>
    );
  }

  return (
    <div className="layout">
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo
      </a>
      <aside className="rail">
        <Brand />
        <ProviderSwitcher />
        <div className="tag">Mission Control</div>

        <button
          className="cmdk-trigger"
          onClick={openPalette}
          aria-label="Buscar páginas e ações"
        >
          <Search size={14} />
          <span>Buscar</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="railnav" aria-label="Navegação principal">
          {GRUPOS.map((grupo) => (
            <div className="railgroup" key={grupo.titulo}>
              <span className="railgroup__label label">{grupo.titulo}</span>
              {grupo.itens.map((item) => {
                const Icon = item.icon;
                const on = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={on ? "active" : ""}
                    aria-current={on ? "page" : undefined}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sysline">
          <span className={`sysdot ${sysClass}`} />
          <span>{sysLabel}</span>
          <span style={{ marginLeft: "auto", opacity: 0.7 }}>{attempts} sessões</span>
        </div>

        <div className="rail-foot">
          <Link href="/account" className="tele">
            <Cloud size={12} /> {cloudLabel}
          </Link>
          <button
            className="iconbtn"
            onClick={toggleTheme}
            aria-label={`Mudar para tema ${theme === "dark" ? "claro" : "escuro"}`}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </aside>

      {/* Densidade por rota: o Banco lista centenas de linhas e a Home tem
          poucos blocos com muito peso. Antes as duas respiravam igual, porque
          densidade só existia na documentação. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="content"
        data-density={densidadeDaRota(pathname)}
        data-page={pathname.split("/")[1] || "home"}
      >
        {children}
      </main>

      {canOpenResultReview && (
        <Link className="resultReviewShortcut" href={`${pathname}/review`}>
          Revisar questão a questão →
        </Link>
      )}

      <nav className="mobilebar" aria-label="Navegação principal">
        {MOBILE.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(pathname, item.href) ? "active" : ""}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{item.short}</span>
            </Link>
          );
        })}
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              className={!MOBILE.some((item) => isActive(pathname, item.href)) ? "active" : ""}
            >
              <Menu size={18} aria-hidden="true" />
              <span>Mais</span>
            </button>
          </SheetTrigger>
          <SheetContent title="Navegação" side="bottom" className="el-navigation-sheet">
            <nav aria-label="Todas as páginas" className="el-mobile-nav">
              {GRUPOS.map((grupo) => (
                <div key={grupo.titulo}>
                  <p className="label">{grupo.titulo}</p>
                  {grupo.itens.map((item) => (
                    <SheetClose asChild key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive(pathname, item.href) ? "page" : undefined}
                      >
                        <item.icon size={16} aria-hidden="true" />
                        {item.label}
                      </Link>
                    </SheetClose>
                  ))}
                </div>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </nav>

      {isResultReview && <ImageZoomHost />}
      <CommandPalette />
    </div>
  );
}
