"use client";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStore } from "@/lib/store";
import { ToastProvider } from "@/components/Toast";
import CloudSyncProvider from "@/components/CloudSyncProvider";

// Mantém o <html data-theme> em dia quando o usuário troca o tema.
// A primeira aplicação é feita pelo script de boot no layout, antes da
// pintura; aqui só reagimos às mudanças posteriores.
function ThemeSync() {
  const theme = useStore((s) => s.db.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme || "dark";
  }, [theme]);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 60 * 1000, // provas raramente mudam
            gcTime: 24 * 60 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ThemeSync />
      <ToastProvider>
        <CloudSyncProvider>{children}</CloudSyncProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
