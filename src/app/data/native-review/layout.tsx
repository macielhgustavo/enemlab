import type { ReactNode } from "react";
import { NativeZipPublisher } from "@/components/native/NativeZipPublisher";

export default function NativeReviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NativeZipPublisher />
      {children}
    </>
  );
}
