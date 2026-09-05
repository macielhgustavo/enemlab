"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Focus, Grid3X3, Keyboard, Type, X } from "lucide-react";

type TextScale = "normal" | "large" | "xl";
type NavItem = {
  index: number;
  label: string;
  answered: boolean;
  flagged: boolean;
  current: boolean;
};

function interactiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

function stateLabel(item: NavItem): string {
  const state = [
    item.current ? "atual" : "",
    item.answered ? "respondida" : "em branco",
    item.flagged ? "marcada para revisão" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `Questão ${item.label}, ${state}`;
}

export default function ExamExperienceHost() {
  const [deepFocus, setDeepFocus] = useState(false);
  const [textScale, setTextScale] = useState<TextScale>("normal");
  const [mapOpen, setMapOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [items, setItems] = useState<NavItem[]>([]);

  const syncNavigator = useCallback(() => {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".examContent .qgrid button"),
    );
    const next = buttons.map((button, index) => {
      const item: NavItem = {
        index,
        label: button.textContent?.trim() || String(index + 1),
        answered: button.classList.contains("answered"),
        flagged: button.classList.contains("flagged"),
        current: button.classList.contains("current"),
      };
      button.setAttribute("aria-label", stateLabel(item));
      if (item.current) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
      return item;
    });

    for (const answer of document.querySelectorAll<HTMLButtonElement>(
      ".examContent .answers button.answer",
    )) {
      answer.setAttribute("aria-pressed", String(answer.classList.contains("selected")));
      const letter = answer.querySelector(".letter")?.textContent?.trim();
      if (letter && !answer.getAttribute("aria-label")) {
        answer.setAttribute("aria-label", `Alternativa ${letter}`);
      }
    }

    const question = document.querySelector<HTMLElement>(".examContent #questionContent");
    if (question) {
      question.setAttribute("role", "region");
      const title = question.querySelector(".qTitle")?.textContent?.trim();
      if (title) question.setAttribute("aria-label", title);
    }

    setItems((prev) => {
      const same =
        prev.length === next.length &&
        prev.every(
          (item, i) =>
            item.label === next[i]?.label &&
            item.answered === next[i]?.answered &&
            item.flagged === next[i]?.flagged &&
            item.current === next[i]?.current,
        );
      return same ? prev : next;
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.examDeepFocus = deepFocus ? "true" : "false";
    return () => {
      delete root.dataset.examDeepFocus;
    };
  }, [deepFocus]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.examText = textScale;
    return () => {
      delete root.dataset.examText;
    };
  }, [textScale]);

  useEffect(() => {
    syncNavigator();
    const observer = new MutationObserver(syncNavigator);
    const root = document.querySelector(".examContent") || document.body;
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    const timer = window.setInterval(syncNavigator, 1500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [syncNavigator]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (interactiveTarget(event.target)) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        setDeepFocus((value) => !value);
      } else if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        setMapOpen((value) => !value);
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((value) => !value);
      } else if (event.key === "Escape") {
        setMapOpen(false);
        setShortcutsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const counts = useMemo(
    () => ({
      answered: items.filter((item) => item.answered).length,
      flagged: items.filter((item) => item.flagged).length,
      blank: items.filter((item) => !item.answered).length,
    }),
    [items],
  );

  const current = items.find((item) => item.current);

  function goToQuestion(index: number) {
    const buttons = document.querySelectorAll<HTMLButtonElement>(".examContent .qgrid button");
    buttons[index]?.click();
    setMapOpen(false);
  }

  function cycleTextScale() {
    setTextScale((value) => (value === "normal" ? "large" : value === "large" ? "xl" : "normal"));
  }

  return (
    <>
      <div className="examExperienceBar" role="toolbar" aria-label="Controles da sessão">
        <button
          type="button"
          className={deepFocus ? "active" : ""}
          onClick={() => setDeepFocus((value) => !value)}
          aria-pressed={deepFocus}
          title="Foco profundo (F)"
        >
          <Focus size={15} />
          <span>{deepFocus ? "Foco ativo" : "Foco"}</span>
          <kbd>F</kbd>
        </button>
        <button type="button" onClick={() => setMapOpen(true)} title="Mapa da prova (M)">
          <Grid3X3 size={15} />
          <span>{current ? `Q${current.label}` : "Mapa"}</span>
          <kbd>M</kbd>
        </button>
        <button type="button" onClick={cycleTextScale} title="Tamanho do texto">
          <Type size={15} />
          <span>{textScale === "normal" ? "100%" : textScale === "large" ? "112%" : "124%"}</span>
        </button>
        <button type="button" onClick={() => setShortcutsOpen(true)} title="Atalhos (?)">
          <Keyboard size={15} />
          <span className="srOnly">Atalhos</span>
        </button>
      </div>

      <div className="srOnly" aria-live="polite">
        {current ? `Questão ${current.label}. ${stateLabel(current)}.` : ""}
      </div>

      {mapOpen && (
        <div className="examOverlay" role="presentation" onMouseDown={() => setMapOpen(false)}>
          <section
            className="examNavigatorDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-map-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="examDialogHead">
              <div>
                <span>MAPA DA PROVA</span>
                <h2 id="exam-map-title">Navegação por estado</h2>
              </div>
              <button type="button" onClick={() => setMapOpen(false)} aria-label="Fechar mapa">
                <X size={18} />
              </button>
            </header>

            <div className="examMapStats" aria-label="Resumo da prova">
              <span><b>{counts.answered}</b> respondidas</span>
              <span><b>{counts.blank}</b> em branco</span>
              <span><b>{counts.flagged}</b> marcadas</span>
            </div>

            <div className="examMapLegend" aria-hidden="true">
              <span><i className="current" /> atual</span>
              <span><i className="answered" /> respondida</span>
              <span><i className="blank" /> em branco</span>
              <span><i className="flagged" /> marcada</span>
            </div>

            <div className="examMapGrid">
              {items.map((item) => (
                <button
                  key={`${item.index}-${item.label}`}
                  type="button"
                  className={[
                    item.current ? "current" : "",
                    item.answered ? "answered" : "blank",
                    item.flagged ? "flagged" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => goToQuestion(item.index)}
                  aria-label={stateLabel(item)}
                  aria-current={item.current ? "true" : undefined}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {shortcutsOpen && (
        <div className="examOverlay" role="presentation" onMouseDown={() => setShortcutsOpen(false)}>
          <section
            className="examShortcutsDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-shortcuts-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="examDialogHead">
              <div>
                <span>ACESSIBILIDADE</span>
                <h2 id="exam-shortcuts-title">Atalhos da sessão</h2>
              </div>
              <button type="button" onClick={() => setShortcutsOpen(false)} aria-label="Fechar atalhos">
                <X size={18} />
              </button>
            </header>
            <div className="examShortcutList">
              <div><kbd>A–E</kbd><span>responder alternativa</span></div>
              <div><kbd>← / →</kbd><span>questão anterior / próxima</span></div>
              <div><kbd>1 / 2 / 3</kbd><span>certeza / dúvida / chute</span></div>
              <div><kbd>F</kbd><span>ativar foco profundo</span></div>
              <div><kbd>M</kbd><span>abrir mapa da prova</span></div>
              <div><kbd>?</kbd><span>mostrar esta ajuda</span></div>
              <div><kbd>Esc</kbd><span>fechar janelas auxiliares</span></div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
