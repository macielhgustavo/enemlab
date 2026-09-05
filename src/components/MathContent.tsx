"use client";
import { useEffect, useRef } from "react";

// Superfície mínima do MathJax que realmente usamos.
interface MathJaxApi {
  tex?: { inlineMath: string[][] };
  options?: { skipHtmlTags: string[] };
  startup?: { typeset: boolean };
  typesetPromise?: (els: HTMLElement[]) => Promise<void>;
}
declare global {
  interface Window {
    MathJax?: MathJaxApi;
  }
}

// Carrega o MathJax uma única vez (sob demanda) e resolve quando pronto.
let mathjaxPromise: Promise<void> | null = null;
function loadMathJax(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (mathjaxPromise) return mathjaxPromise;
  mathjaxPromise = new Promise<void>((resolve) => {
    window.MathJax = {
      tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]] },
      options: { skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"] },
      startup: { typeset: false },
    };
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  return mathjaxPromise;
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
    loadMathJax().then(() => {
      const mj = window.MathJax;
      if (!cancelled && ref.current && mj?.typesetPromise) {
        mj.typesetPromise([ref.current]).catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, [html]);
  return (
    <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
