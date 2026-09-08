"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Dialog } from "radix-ui";
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
  UserRound,
  GraduationCap,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { normalizeText } from "@/lib/format";
import { listProviders, resolveProviderId } from "@/lib/providers";

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
  const activeProvider = useStore((s) => resolveProviderId(s.db.activeProvider));
  const setProvider = useStore((s) => s.setActiveProvider);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const reducedMotion = useReducedMotion();

  const commands: Cmd[] = useMemo(
    () => [
      { id: "home", label: "Ir para Início", icon: Home, run: () => router.push("/") },
      {
        id: "practice",
        label: "Montar treino",
        hint: "novo",
        icon: Dumbbell,
        run: () => router.push("/practice"),
      },
      { id: "bank", label: "Abrir Banco", icon: Library, run: () => router.push("/bank") },
      {
        id: "adaptive",
        label: "Adaptive 2.0",
        icon: Sparkles,
        run: () => router.push("/adaptive"),
      },
      { id: "plano", label: "Plano de estudo", icon: Map, run: () => router.push("/plano") },
      {
        id: "mastery",
        label: "Mapa de domínio",
        icon: Gauge,
        run: () => router.push("/mastery"),
      },
      { id: "srs", label: "Revisões (SRS)", icon: RotateCcw, run: () => router.push("/srs") },
      { id: "history", label: "Histórico", icon: Clock, run: () => router.push("/history") },
      {
        id: "review",
        label: "Caderno de erros",
        icon: BookX,
        run: () => router.push("/review"),
      },
      { id: "data", label: "Dados e backup", icon: Database, run: () => router.push("/data") },
      {
        id: "account",
        label: "Conta e sincronização",
        icon: UserRound,
        run: () => router.push("/account"),
      },
      // Trocar de prova é ação de teclado tanto quanto navegar. A prova
      // ativa não aparece na lista: mandar "trocar" para onde já se está
      // seria um comando que não faz nada.
      ...listProviders()
        .filter((p) => p.id !== activeProvider)
        .map((p) => ({
          id: `provider-${p.id}`,
          label: `Trocar para ${p.metadata.shortLabel}`,
          hint: p.metadata.label,
          icon: GraduationCap,
          run: () => setProvider(p.id),
        })),
      {
        id: "theme",
        label: "Alternar tema claro/escuro",
        icon: Moon,
        run: () => toggleTheme(),
      },
    ],
    [router, toggleTheme, activeProvider, setProvider],
  );

  const filtered = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return commands;
    return commands.filter(
      (c) => normalizeText(c.label).includes(q) || normalizeText(c.hint ?? "").includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (
          document.activeElement instanceof HTMLElement &&
          !document.activeElement.closest(".cmdk")
        ) {
          returnFocusRef.current = document.activeElement;
        }
        // Zera a busca no próprio handler em vez de sincronizar por efeito.
        setQuery("");
        setActive(0);
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mantém a seleção válida quando a lista encolhe, sem efeito de sincronização.
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));
  useEffect(() => {
    if (open && filtered[activeIndex]) {
      document
        .getElementById(`cmdk-${filtered[activeIndex].id}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, filtered, open]);

  const choose = useCallback((cmd?: Cmd) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  }, []);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(filtered[activeIndex]);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmdk-backdrop" />
        <Dialog.Content
          asChild
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <motion.div
            className="cmdk"
            initial={{ opacity: reducedMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.12 }}
          >
            <Dialog.Title className="el-visually-hidden">Buscar páginas e ações</Dialog.Title>
            <Dialog.Description className="el-visually-hidden">
              Use as setas para escolher, Enter para abrir e Escape para fechar.
            </Dialog.Description>
            <div className="cmdk-search">
              <Search size={17} style={{ color: "var(--muted)" }} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onListKey}
                placeholder="Buscar telas e ações…"
                aria-label="Buscar telas e ações"
                role="combobox"
                aria-expanded
                aria-controls="cmdk-listbox"
                aria-activedescendant={
                  filtered[activeIndex] ? `cmdk-${filtered[activeIndex].id}` : undefined
                }
              />
              <kbd className="cmdk-esc">esc</kbd>
            </div>
            <div className="cmdk-list" id="cmdk-listbox" role="listbox">
              {filtered.length === 0 && <div className="cmdk-empty">Nada encontrado.</div>}
              {filtered.map((c, i) => {
                const Icon = c.icon;
                const isActive = i === activeIndex;
                return (
                  <div
                    key={c.id}
                    id={`cmdk-${c.id}`}
                    role="option"
                    aria-selected={isActive}
                    className={`cmdk-item ${isActive ? "active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(c)}
                  >
                    <Icon size={17} />
                    <span>{c.label}</span>
                    {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                    {isActive && <CornerDownLeft size={14} className="cmdk-enter" />}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
