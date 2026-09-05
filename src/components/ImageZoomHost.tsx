"use client";
import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";

type ZoomState = { src: string; alt: string } | null;

export default function ImageZoomHost() {
  const [zoom, setZoom] = useState<ZoomState>(null);

  useEffect(() => {
    const prepare = (root: ParentNode = document) => {
      for (const img of root.querySelectorAll<HTMLImageElement>(".examContent img")) {
        img.dataset.zoomable = "true";
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        if (!img.getAttribute("aria-label")) {
          img.setAttribute("aria-label", `${img.alt || "Imagem da questão"}. Clique para ampliar.`);
        }
        img.title = "Clique para ampliar";
      }
    };

    prepare();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) prepare(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const open = (img: HTMLImageElement) => {
      const src = img.currentSrc || img.src;
      if (!src) return;
      setZoom({ src, alt: img.alt || "Imagem da questão" });
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !target.closest(".examContent")) return;
      event.preventDefault();
      open(target);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === "Escape") {
        setZoom(null);
        return;
      }
      if (
        (event.key === "Enter" || event.key === " ") &&
        target instanceof HTMLImageElement &&
        target.closest(".examContent")
      ) {
        event.preventDefault();
        open(target);
      }
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  if (!zoom) return null;

  return (
    <div className="imageZoomBackdrop" role="presentation" onMouseDown={() => setZoom(null)}>
      <div
        className="imageZoomDialog"
        role="dialog"
        aria-modal="true"
        aria-label="Imagem ampliada da questão"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="imageZoomBar">
          <span>
            <Maximize2 size={14} /> imagem ampliada
          </span>
          <button type="button" onClick={() => setZoom(null)} aria-label="Fechar imagem ampliada">
            <X size={18} />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={zoom.src} alt={zoom.alt} />
        <div className="imageZoomHint">Esc para fechar • clique fora da imagem para voltar</div>
      </div>
    </div>
  );
}
