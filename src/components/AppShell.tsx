"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Dumbbell,
  Library,
  SlidersHorizontal,
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
import { examLabel } from "@/lib/providers/label";

const NAV = [
  { href: "/", label: "Início", icon: Home, short: "Início" },
  { href: "/plano", label: "Plano de hoje", icon: Map, short: "Plano" },
  { href: "/bank", label: "Banco", icon: Library, short: "Banco" },
  { href: "/srs", label: "Revisões", icon: RotateCcw, short: "Revisões" },
  { href: "/mastery", label: "Domínio", icon: Gauge, short: "Domínio" },
  { href: "/history", label: "Histórico", icon: Clock, short: "Histórico" },
  { href: "/review", label: "Erros", icon: BookX, short: "Erros" },
  { href: "/practice", label: "Treino manual", icon: Dumbbell, short: "Treino" },
  {
    href: "/adaptive",
    label: "Motor adaptativo",
    icon: SlidersHorizontal,
    short: "Adaptativo",
  },
  { href: "/data", label: "Dados", icon: Database, short: "Dados" },
  { href: "/account", label: "Conta", icon: UserRound, short: "Conta" },
];

const PRIMARY_GROUPS: { titulo: string; itens: typeof NAV }[] = [
  {
    titulo: "Estudar",
    itens: NAV.filter((item) => ["/", "/plano", "/bank", "/srs"].includes(item.href)),
  },
  {
    titulo: "Acompanhar",
    itens: NAV.filter((item) => ["/mastery", "/history", "/review"].includes(item.href)),
  },
];

const ADVANCED_GROUPS: { titulo: string; itens: typeof NAV }[] = [
  {
    titulo: "Ferramentas",
    itens: NAV.filter((item) => ["/practice", "/adaptive"].includes(item.href)),
  },
  {
    titulo: "Sistema",
    itens: NAV.filter((item) => ["/data", "/account"].includes(item.href)),
  },
];

const ALL_GROUPS = [...PRIMARY_GROUPS, ...ADVANCED_GROUPS];
const MOBILE = NAV.filter((item) => ["/", "/plano", "/bank", "/srs"].includes(item.href));

function openPalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
  );
}

function densidadeDaRota(pathname: string): "compact" | "default" | "spacious" {
  if (pathname === "/") return "spacious";
  if (pathname.startsWith("/bank") || pathname.startsWith("/srs")) return "compact";
  return "default";
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavItems({
  pathname,
  items,
}: {
  pathname: string;
  items: typeof NAV;
}) {
  return items.map((item) => {
    const Icon = item.icon;
    const on = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={on ? "active" : ""}
        aria-current={on ? "page" : undefined}
      >
        <Icon size={16} aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    );
  });
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
  const advancedActive = ADVANCED_GROUPS.some((group) =>
    group.itens.some((item) => isActive(pathname, item.href)),
  );

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

        <nav className="railnav" aria-label="Navegação principal">
          {PRIMARY_GROUPS.map((group) => (
            <div className="railgroup" key={group.titulo}>
              <span className="railgroup__label label">{group.titulo}</span>
              <NavItems pathname={pathname} items={group.itens} />
            </div>
          ))}

          <details className="el-rail-more" open={advancedActive || undefined}>
            <summary
              className={`el-rail-more__summary ${advancedActive ? "active" : ""}`}
            >
              <Menu size={16} aria-hidden="true" />
              <span>Mais</span>
            </summary>
            <div className="el-rail-more__body">
              {ADVANCED_GROUPS.map((group) => (
                <div className="railgroup" key={group.titulo}>
                  <span className="railgroup__label label">{group.titulo}</span>
                  <NavItems pathname={pathname} items={group.itens} />
                </div>
              ))}
            </div>
          </details>
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
        </div>
      </aside>

      <div className="workspace">
        <header className="app-topbar">
          <div className="app-topbar__context">
            <span className="app-topbar__eyebrow">Centro de performance</span>
            <strong>{hydrated ? examLabel(db.activeProvider) : "ENEM Lab"}</strong>
            <span className="app-topbar__status">
              <i className={`sysdot ${sysClass}`} aria-hidden="true" />
              {sysLabel}
            </span>
          </div>

          <div className="app-topbar__actions">
            <button
              className="app-topbar__search"
              onClick={openPalette}
              aria-label="Buscar páginas e ações"
            >
              <Search size={15} aria-hidden="true" />
              <span>Buscar questões, tópicos e ações</span>
              <kbd>⌘K</kbd>
            </button>
            <ProviderSwitcher className="app-topbar__provider" />
            <button
              className="app-topbar__icon"
              onClick={toggleTheme}
              aria-label={`Mudar para tema ${theme === "dark" ? "claro" : "escuro"}`}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <Link className="app-topbar__train" href="/plano">
              Plano de hoje
            </Link>
            <Link className="app-topbar__avatar" href="/account" aria-label="Abrir conta">
              MC
            </Link>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="content"
          data-density={densidadeDaRota(pathname)}
          data-page={pathname.split("/")[1] || "home"}
        >
          {children}
        </main>
      </div>

      {canOpenResultReview && (
        <Link className="resultReviewShortcut" href={`${pathname}/review`}>
          Revisar questão a questão →
        </Link>
      )}

      <nav className="mobilebar" aria-label="Navegação principal">
        {MOBILE.map((item) => {
          const Icon = item.icon;
          const on = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={on ? "active" : ""}
              aria-current={on ? "page" : undefined}
            >
              <Icon size={18} aria-hidden="true" />
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
              {ALL_GROUPS.map((group) => (
                <div key={group.titulo}>
                  <p className="label">{group.titulo}</p>
                  {group.itens.map((item) => (
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
