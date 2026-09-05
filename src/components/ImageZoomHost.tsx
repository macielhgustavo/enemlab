"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Maximize2, Minus, Move, Plus, RotateCcw, X } from "lucide-react";

type ZoomState = { src: string; alt: string } | null;
type Point = { x: number; y: number };

const LEVELS = [1, 1.5, 2] as const;

function closestLevel(value: number): number {
  return LEVELS.reduce((best, current) =>
    Math.abs(current - value) < Math.abs(best - value) ? current : best,
  );
}

function isZoomScope(img: HTMLImageElement): boolean {
  return !!img.closest(".examContent, .resultReviewPage");
}

export default function ImageZoomHost() {
  const [zoom, setZoom] = useState<ZoomState>(null);
  const [scale, setScale] = useState<number>(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null);

  const setLevel = useCallback((next: number) => {
    const level = closestLevel(next);
    setScale(level);
    if (level === 1) setOffset({ x: 0, y: 0 });
  }, []);

  const close = useCallback(() => {
    setZoom(null);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    drag.current = null;
  }, []);

  useEffect(() => {
    const prepareImage = (img: HTMLImageElement) => {
      if (!isZoomScope(img)) return;
      img.dataset.zoomable = "true";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      if (!img.getAttribute("aria-label")) {
        img.setAttribute("aria-label", `${img.alt || "Imagem da questão"}. Clique para ampliar.`);
      }
      img.title = "Clique para ampliar";
    };

    const prepare = (root: ParentNode = document) => {
      if (root instanceof HTMLImageElement) prepareImage(root);
      for (const img of root.querySelectorAll<HTMLImageElement>(
        ".examContent img, .resultReviewPage img",
      )) {
        prepareImage(img);
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
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setZoom({ src, alt: img.alt || "Imagem da questão" });
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !isZoomScope(target)) return;
      event.preventDefault();
      open(target);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === "Escape") {
        close();
        return;
      }
      if (zoom && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        setLevel(scale < 1.5 ? 1.5 : 2);
        return;
      }
      if (zoom && event.key === "-") {
        event.preventDefault();
        setLevel(scale > 1.5 ? 1.5 : 1);
        return;
      }
      if (
        (event.key === "Enter" || event.key === " ") &&
        target instanceof HTMLImageElement &&
        isZoomScope(target)
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
  }, [close, scale, setLevel, zoom]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scale <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: offset,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId || scale <= 1) return;
    setOffset({
      x: d.origin.x + event.clientX - d.start.x,
      y: d.origin.y + event.clientY - d.start.y,
    });
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.deltaY < 0) setLevel(scale < 1.5 ? 1.5 : 2);
    else setLevel(scale > 1.5 ? 1.5 : 1);
  };

  if (!zoom) return null;

  return (
    <div className="imageZoomBackdrop" role="presentation" onMouseDown={close}>
      <div
        className="imageZoomDialog"
        role="dialog"
        aria-modal="true"
        aria-label="Imagem ampliada da questão"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="imageZoomBar">
          <span className="imageZoomTitle">
            <Maximize2 size={14} /> imagem ampliada
          </span>
          <div className="imageZoomControls" aria-label="Controles de ampliação">
            <button
              type="button"
              onClick={() => setLevel(scale > 1.5 ? 1.5 : 1)}
              disabled={scale <= 1}
              aria-label="Diminuir zoom"
            >
              <Minus size={16} />
            </button>
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                className={scale === level ? "active" : ""}
                onClick={() => setLevel(level)}
              >
                {Math.round(level * 100)}%
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLevel(scale < 1.5 ? 1.5 : 2)}
              disabled={scale >= 2}
              aria-label="Aumentar zoom"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
              aria-label="Restaurar imagem"
            >
              <RotateCcw size={15} />
            </button>
            <button type="button" onClick={close} aria-label="Fechar imagem ampliada">
              <X size={18} />
            </button>
          </div>
        </div>

        <div
          className={`imageZoomViewport ${scale > 1 ? "canPan" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onWheel={onWheel}
          onDoubleClick={() => setLevel(scale === 1 ? 2 : 1)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoom.src}
            alt={zoom.alt}
            draggable={false}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        </div>

        <div className="imageZoomHint">
          {scale > 1 ? (
            <><Move size={13} /> arraste para navegar • roda do mouse ou +/- muda o zoom</>
          ) : (
            <>duplo clique para 200% • Esc para fechar</>
          )}
        </div>
      </div>
    </div>
  );
}
