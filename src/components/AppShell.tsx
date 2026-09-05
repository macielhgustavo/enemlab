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

function openPalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }),
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useStore((s) => s.db.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  return (
    <div className="layout">
      <aside className="rail">
        <div className="brand">
          <span className="mark">E</span>
          <span className="name">ENEM Lab</span>
        </div>
        <div className="tag">Adaptive · Estatística · SRS</div>

        <button className="cmdk-trigger" onClick={openPalette}>
          <Search size={15} />
          <span>Buscar</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="railnav">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                <Icon size={17} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="rail-foot">
          <span className="muted" style={{ fontSize: 11 }}>
            {theme === "dark" ? "Tema escuro" : "Tema claro"}
          </span>
          <button className="iconbtn" onClick={toggleTheme} aria-label="Alternar tema">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
      <CommandPalette />
    </div>
  );
}
