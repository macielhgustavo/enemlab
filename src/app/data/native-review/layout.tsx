import type { ReactNode } from "react";
import { NativeZipPublisher } from "@/components/native/NativeZipPublisher";

// Mantém o publicador ZIP simples disponível no topo da revisão nativa.
export default function NativeReviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NativeZipPublisher />
      {children}
    </>
  );
}
