import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import AppShell from "@/components/AppShell";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ENEM Lab",
  description: "Plataforma pessoal adaptativa para questões reais do ENEM.",
};

// Aplica o tema salvo antes da primeira pintura. Sem isto o HTML sai sempre
// claro do servidor e quem usa o tema escuro vê um flash branco a cada carga.
// Precisa ser síncrono e tolerante a storage indisponível ou corrompido.
const THEME_BOOT = `try{var s=localStorage.getItem("enem_lab_v7");var t=s&&JSON.parse(s);t=t&&t.state&&t.state.db&&t.state.db.theme;document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: o script acima e as extensões do navegador
    // (ex.: ColorZilla, que injeta cz-shortcut-listen) alteram estes dois
    // elementos antes do React hidratar.
    <html lang="pt-BR" data-theme="dark" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
