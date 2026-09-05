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
  { href: "/", label: "Início", icon: Home },
  { href: "/practice", label: "Treinar", icon: Dumbbell },
  { href: "/bank", label: "Banco", icon: Library },
  { href: "/adaptive", label: "Adaptive 2.0", icon: Sparkles },
  { href: "/plano", label: "Plano", icon: Map },
  { href: "/mastery", label: "Domínio", icon: Gauge },
  { href: "/srs", label: "Revisões", icon: RotateCcw },
  { href: "/history", label: "Histórico", icon: Clock },
  { href: "/review", label: "Erros", icon: BookX },
  { href: "/data", label: "Dados", icon: Database },
];

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

  // O runner assume a tela inteira: sem barra de contexto competindo.
  const focusMode = pathname.startsWith("/exam/");

  const due = hydrated ? dueSRS(db).length : 0;
  const sessions = hydrated ? db.attempts.filter((a) => a.result).length : 0;
  const sysClass = !hydrated ? "" : due > 10 ? "bad" : due > 0 ? "warn" : "";
  const current = NAV.find((n) => isActive(pathname, n.href));

  return (
    <div className="layout">
      <aside className="rail">
        <Link href="/" className="brand" aria-label="ENEM Lab, ir para o início">
          <span className="mark">E</span>
          <span className="name">ENEM Lab</span>
        </Link>

        <button className="cmdk-trigger" onClick={openPalette} aria-label="Buscar (Ctrl+K)">
          <Search size={15} />
          <span>Buscar</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="railnav" aria-label="Navegação principal">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                data-label={item.label}
                className={active ? "active" : ""}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sysline" title={due > 0 ? `${due} revisões vencidas` : "Revisões em dia"}>
          <span className={`sysdot ${sysClass}`} />
          <span>{due > 0 ? `${due} pendentes` : "em dia"}</span>
        </div>

        <div className="rail-foot">
          <button
            className="iconbtn"
            onClick={toggleTheme}
            aria-label={`Mudar para tema ${theme === "dark" ? "claro" : "escuro"}`}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </aside>

      <div style={{ minWidth: 0 }}>
        {!focusMode && (
          <header className="topbar">
            <span className="crumb">{current?.label ?? "ENEM Lab"}</span>
            <div className="now">
              <span>
                <b>{sessions}</b> sessões
              </span>
              <span>
                <b>{due}</b> na fila
              </span>
              <span className={`sysdot ${sysClass}`} aria-hidden="true" />
            </div>
          </header>
        )}
        <main className="content">{children}</main>
      </div>

      {!focusMode && (
        <nav className="mobilebar" aria-label="Navegação">
          {MOBILE.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}

      <CommandPalette />
    </div>
  );
}
