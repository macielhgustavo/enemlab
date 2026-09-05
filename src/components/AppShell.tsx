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
} from "lucide-react";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";
import { dueSRS } from "@/lib/domain/srs";
import CommandPalette from "@/components/CommandPalette";

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
];

// Barra inferior do mobile: as cinco rotas de maior uso.
const MOBILE = [NAV[0], NAV[1], NAV[3], NAV[6], NAV[5]];

function openPalette() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
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

  // Telemetria do sistema (só depois da hidratação, para não divergir do SSR).
  const due = hydrated ? dueSRS(db).length : 0;
  const attempts = hydrated ? db.attempts.length : 0;
  const sysClass = !hydrated ? "" : due > 10 ? "bad" : due > 0 ? "warn" : "";
  const sysLabel = !hydrated
    ? "sincronizando"
    : due > 0
      ? `${due} pendente${due > 1 ? "s" : ""}`
      : "tudo em dia";

  return (
    <div className="layout">
      <aside className="rail">
        <div className="brand">
          <span className="mark">E</span>
          <span className="name">ENEM Lab</span>
        </div>
        <div className="tag">Mission Control</div>

        <button className="cmdk-trigger" onClick={openPalette}>
          <Search size={14} />
          <span>Buscar</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="railnav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive(pathname, item.href) ? "active" : ""}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sysline">
          <span className={`sysdot ${sysClass}`} />
          <span>{sysLabel}</span>
          <span style={{ marginLeft: "auto", opacity: 0.7 }}>{attempts} sessões</span>
        </div>

        <div className="rail-foot">
          <span className="tele">{theme === "dark" ? "Escuro" : "Claro"}</span>
          <button
            className="iconbtn"
            onClick={toggleTheme}
            aria-label={`Mudar para tema ${theme === "dark" ? "claro" : "escuro"}`}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </aside>

      <main className="content">{children}</main>

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
      </nav>

      <CommandPalette />
    </div>
  );
}
