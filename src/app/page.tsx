import type { Metadata } from "next";
import { cookies } from "next/headers";
import DashboardHome from "@/components/DashboardHome";
import LandingPage from "@/components/landing/LandingPage";
import { ADMIN_SESSION_COOKIE, hasAdminSession } from "@/lib/admin-auth";

async function authenticated() {
  const cookieStore = await cookies();
  return hasAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  if (await authenticated()) return {};
  return {
    title: "Studium Labs — Performance acadêmica",
    description:
      "Treine, analise e domine provas com um sistema de performance acadêmica para ENEM, ITA, IME, FUVEST e vestibulares.",
  };
}

export default async function HomePage() {
  return (await authenticated()) ? <DashboardHome /> : <LandingPage />;
}
