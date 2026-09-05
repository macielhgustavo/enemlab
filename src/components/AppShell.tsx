"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

const NAV = [
  { href: "/", label: "Início" },
  { href: "/practice", label: "Treinar" },
  { href: "/bank", label: "Banco" },
  { href: "/adaptive", label: "Adaptive 2.0" },
  { href: "/mastery", label: "Domínio" },
  { href: "/srs", label: "Revisões" },
  { href: "/history", label: "Histórico" },
  { href: "/review", label: "Erros" },
  { href: "/data", label: "Dados" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const toggleTheme = useStore((s) => s.toggleTheme);

  return (
    <>
      <header className="top">
        <div className="topin">
          <div className="logo">
            <span className="mark">E</span>
            <span>ENEM Lab</span>
          </div>
          <span className="pill">Next.js • Adaptive • Estatística • SRS</span>
          <div className="spacer" />
          <button className="iconbtn" onClick={toggleTheme} aria-label="Alternar tema">
            ◐
          </button>
        </div>
      </header>

      <main className="shell">
        <nav className="nav">
          {NAV.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </main>
    </>
  );
}
