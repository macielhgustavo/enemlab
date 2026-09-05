"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  Moon,
  Search,
  CornerDownLeft,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { normalizeText } from "@/lib/format";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ size?: number }>;
  run: () => void;
}

export default function CommandPalette() {
  const router = useRouter();
  const toggleTheme = useStore((s) => s.toggleTheme);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Cmd[] = useMemo(
    () => [
      { id: "home", label: "Ir para Início", icon: Home, run: () => router.push("/") },
      { id: "practice", label: "Montar treino", hint: "novo", icon: Dumbbell, run: () => router.push("/practice") },
      { id: "bank", label: "Abrir Banco", icon: Library, run: () => router.push("/bank") },
      { id: "adaptive", label: "Adaptive 2.0", icon: Sparkles, run: () => router.push("/adaptive") },
      { id: "plano", label: "Plano de estudo", icon: Map, run: () => router.push("/plano") },
      { id: "mastery", label: "Mapa de domínio", icon: Gauge, run: () => router.push("/mastery") },
      { id: "srs", label: "Revisões (SRS)", icon: RotateCcw, run: () => router.push("/srs") },
      { id: "history", label: "Histórico", icon: Clock, run: () => router.push("/history") },
      { id: "review", label: "Caderno de erros", icon: BookX, run: () => router.push("/review") },
      { id: "data", label: "Dados e backup", icon: Database, run: () => router.push("/data") },
      { id: "theme", label: "Alternar tema claro/escuro", icon: Moon, run: () => toggleTheme() },
    ],
    [router, toggleTheme],
  );

  const filtered = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return commands;
    return commands.filter((c) => normalizeText(c.label).includes(q));
  }, [commands, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const choose = useCallback(
    (cmd?: Cmd) => {
      if (!cmd) return;
      setOpen(false);
      cmd.run();
    },
    [],
  );

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[active]);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmdk-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="cmdk"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cmdk-search">
              <Search size={17} style={{ color: "var(--muted)" }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKey}
                placeholder="Buscar telas e ações…"
                aria-label="Comando"
              />
              <kbd className="cmdk-esc">esc</kbd>
            </div>
            <div className="cmdk-list">
              {filtered.length === 0 && <div className="cmdk-empty">Nada encontrado.</div>}
              {filtered.map((c, i) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    className={`cmdk-item ${i === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(c)}
                  >
                    <Icon size={17} />
                    <span>{c.label}</span>
                    {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                    {i === active && <CornerDownLeft size={14} className="cmdk-enter" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
