"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
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
  LayoutGrid,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import CommandPalette from "@/components/CommandPalette";

const MODULES = [
  { href: "/", label: "Bancada", icon: Home },
  { href: "/practice", label: "Montar experimento", icon: Dumbbell },
  { href: "/bank", label: "Acervo", icon: Library },
  { href: "/adaptive", label: "Adaptive 2.0", icon: Sparkles },
  { href: "/plano", label: "Plano", icon: Map },
  { href: "/mastery", label: "Domínio", icon: Gauge },
  { href: "/srs", label: "Revisões", icon: RotateCcw },
  { href: "/history", label: "Histórico", icon: Clock },
  { href: "/review", label: "Caderno de erros", icon: BookX },
  { href: "/data", label: "Dados", icon: Database },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useStore((s) => s.db.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const [open, setOpen] = useState(false);

  const onCanvas = pathname === "/";
  const inExam = pathname.startsWith("/exam/");
  const current = MODULES.find((m) => isActive(pathname, m.href));

  return (
    <div className="layout">
      <main className="content">
        {/* A bancada desenha o próprio canvas; as demais telas ganham medida. */}
        {onCanvas || inExam ? children : <div className="labpage">{children}</div>}
      </main>

      {!inExam && (
        <button
          className="launcher"
          onClick={() => setOpen(true)}
          style={{ position: "fixed", left: 24, bottom: 24, zIndex: 80 }}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <LayoutGrid size={15} />
          <span>{current?.label ?? "Módulos"}</span>
          <kbd>⌘K</kbd>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            className="sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Módulos"
          >
            <motion.div
              className="sheet-in"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="row between">
                <span className="ptitle" style={{ margin: 0 }}>
                  Módulos do laboratório
                </span>
                <button className="iconbtn" onClick={() => setOpen(false)} aria-label="Fechar">
                  <X size={15} />
                </button>
              </div>
              <div className="sheet-grid">
                {MODULES.map((m, i) => {
                  const Icon = m.icon;
                  return (
                    <motion.div
                      key={m.href}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.03 * i, duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <Link
                        href={m.href}
                        className={isActive(pathname, m.href) ? "active" : ""}
                        onClick={() => setOpen(false)}
                      >
                        <Icon size={17} />
                        {m.label}
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
              <div className="row between" style={{ marginTop: 16 }}>
                <span className="ptitle" style={{ margin: 0 }}>
                  Tema {theme === "dark" ? "escuro" : "claro"}
                </span>
                <button className="iconbtn" onClick={toggleTheme} aria-label="Alternar tema">
                  {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette />
    </div>
  );
}
