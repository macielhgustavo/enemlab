"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

const NAV = [
  { href: "/", label: "Início" },
  { href: "/practice", label: "Treinar" },
  { href: "/bank", label: "Banco" },
  { href: "/adaptive", label: "Adaptive 2.0" },
  { href: "/plano", label: "Plano" },
  { href: "/mastery", label: "Domínio" },
  { href: "/srs", label: "Revisões" },
  { href: "/history", label: "Histórico" },
  { href: "/review", label: "Erros" },
  { href: "/data", label: "Dados" },
];

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
        <nav className="railnav">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="rail-foot">
          <span className="muted" style={{ fontSize: 11 }}>
            {theme === "dark" ? "Tema escuro" : "Tema claro"}
          </span>
          <button className="iconbtn" onClick={toggleTheme} aria-label="Alternar tema">
            ◐
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
