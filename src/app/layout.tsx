import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import "./exam-focus.css";
import "./question-content.css";
import "./question-interactions.css";
import "./exam-experience.css";
import "./result-review.css";
import "./experience-polish.css";
import "./daily-plan.css";
import "./account.css";
import "../styles/refinement.css";
import "./landing.css";
import "./landing-fidelity.css";
import { PRODUCT_BRAND } from "@/components/Brand";
import Providers from "@/components/Providers";
import AppShell from "@/components/AppShell";
import { ADMIN_SESSION_COOKIE, hasAdminSession } from "@/lib/admin-auth";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: PRODUCT_BRAND.name,
  description: PRODUCT_BRAND.description,
};

const THEME_BOOT = `try{var s=localStorage.getItem("enem_lab_v7");var t=s&&JSON.parse(s);t=t&&t.state&&t.state.db&&t.state.db.theme;document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){document.documentElement.dataset.theme="dark"}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const authenticated = hasAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);

  return (
    <html lang="pt-BR" data-theme="dark" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {!authenticated && <link rel="preconnect" href="https://fonts.googleapis.com" />}
        {!authenticated && (
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        )}
        {!authenticated && (
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&display=swap"
          />
        )}
      </head>
      <body className={authenticated ? undefined : "public-shell"} suppressHydrationWarning>
        <Providers>{authenticated ? <AppShell>{children}</AppShell> : children}</Providers>
      </body>
    </html>
  );
}
