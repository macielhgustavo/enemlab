"use client";

import Image from "next/image";
import { useState } from "react";
import type { NativeRect } from "@/lib/native/contracts";

interface NativeImageSize {
  width: number;
  height: number;
}

export function NativeCropImage({
  src,
  rect,
  alt,
  className = "",
}: {
  src: string;
  rect: NativeRect;
  alt: string;
  className?: string;
}) {
  const [size, setSize] = useState<NativeImageSize>({ width: 1200, height: 1700 });
  const cropWidth = Math.max(1, size.width * rect.width);
  const cropHeight = Math.max(1, size.height * rect.height);
  const aspectRatio = cropWidth / cropHeight;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: String(aspectRatio),
        overflow: "hidden",
        borderRadius: 12,
        background: "var(--card, #fff)",
      }}
    >
      <Image
        src={src}
        alt={alt}
        width={size.width}
        height={size.height}
        unoptimized
        onLoad={(event) => {
          const width = event.currentTarget.naturalWidth;
          const height = event.currentTarget.naturalHeight;
          if (width && height) setSize({ width, height });
        }}
        style={{
          position: "absolute",
          width: `${100 / rect.width}%`,
          height: "auto",
          maxWidth: "none",
          left: `${-(rect.x / rect.width) * 100}%`,
          top: `${-(rect.y / rect.height) * 100}%`,
        }}
      />
    </div>
  );
}

export function NativePageWithRegion({
  src,
  rect,
  alt,
}: {
  src: string;
  rect: NativeRect;
  alt: string;
}) {
  const [aspectRatio, setAspectRatio] = useState(1200 / 1700);
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: String(aspectRatio),
        overflow: "hidden",
        borderRadius: 12,
        background: "#fff",
      }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        unoptimized
        sizes="(max-width: 900px) 100vw, 50vw"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth && naturalHeight) setAspectRatio(naturalWidth / naturalHeight);
        }}
        style={{ objectFit: "contain" }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
          height: `${rect.height * 100}%`,
          border: "2px solid currentColor",
          background: "color-mix(in srgb, currentColor 10%, transparent)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
