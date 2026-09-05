import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./exam-focus.css";
import "./question-content.css";
import "./question-interactions.css";
import "./exam-experience.css";
import "./result-review.css";
import "./experience-polish.css";
import "./daily-plan.css";
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

const THEME_BOOT = `try{var s=localStorage.getItem("enem_lab_v7");var t=s&&JSON.parse(s);t=t&&t.state&&t.state.db&&t.state.db.theme;document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
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
