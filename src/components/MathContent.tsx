"use client";
import { useEffect, useRef } from "react";

interface MathJaxApi {
  tex?: {
    inlineMath?: string[][];
    displayMath?: string[][];
    processEscapes?: boolean;
  };
  options?: { skipHtmlTags: string[] };
  startup?: { typeset: boolean };
  chtml?: { matchFontHeight?: boolean };
  typesetClear?: (els: HTMLElement[]) => void;
  typesetPromise?: (els: HTMLElement[]) => Promise<void>;
}
declare global {
  interface Window {
    MathJax?: MathJaxApi;
  }
}

let mathjaxPromise: Promise<void> | null = null;

function loadMathJax(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.MathJax?.typesetPromise) return Promise.resolve();
  if (mathjaxPromise) return mathjaxPromise;

  mathjaxPromise = new Promise<void>((resolve) => {
    window.MathJax = {
      tex: {
        inlineMath: [["$", "$"], ["\\(", "\\)"]],
        displayMath: [["$$", "$$"], ["\\[", "\\]"]],
        processEscapes: true,
      },
      options: { skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"] },
      startup: { typeset: false },
      chtml: { matchFontHeight: false },
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-enem-mathjax="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.dataset.enemMathjax = "true";
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });

  return mathjaxPromise;
}

function classifyMedia(root: HTMLElement) {
  for (const img of root.querySelectorAll<HTMLImageElement>("img")) {
    img.dataset.zoomable = "true";
    img.classList.add("questionMedia");

    const apply = () => {
      const holder = img.closest<HTMLElement>(".embeddedMedia");
      if (!holder) return;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const isFigure = w >= 300 || h >= 170 || (w >= 220 && h >= 120);
      holder.classList.toggle("blockMedia", isFigure);
      holder.classList.toggle("inlineMedia", !isFigure);
    };

    if (img.complete) apply();
    else img.addEventListener("load", apply, { once: true });
  }
}

export default function MathContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const root = ref.current;
    if (!root) return;

    classifyMedia(root);

    loadMathJax().then(() => {
      const mj = window.MathJax;
      if (cancelled || !ref.current || !mj?.typesetPromise) return;
      try {
        mj.typesetClear?.([ref.current]);
      } catch {
        // Conteúdo ainda não tinha sido processado pelo MathJax.
      }
      mj.typesetPromise([ref.current]).catch(() => {
        // CDN indisponível: o TeX permanece legível em vez de quebrar a questão.
      });
    });

    return () => {
      cancelled = true;
    };
  }, [html]);

  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
