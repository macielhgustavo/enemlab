"use client";

import { useState } from "react";
import { DashboardSkeleton } from "@/components/Skeleton";
import { useActiveProvider } from "@/components/ExamSwitch";
import { Dashboard } from "@/components/enem-lab/dashboard/Dashboard";
import { buildDashboardModel } from "@/lib/domain/dashboard";
import { useHydrated } from "@/lib/hooks";
import { useStore } from "@/lib/store";

export default function HomePage() {
  const db = useStore((state) => state.db);
  const hydrated = useHydrated();
  const { providerId } = useActiveProvider();
  const [now] = useState(() => new Date());

  if (!hydrated) return <DashboardSkeleton />;

  const model = buildDashboardModel(db, providerId, now);
  return <Dashboard model={model} providerId={providerId} now={now} />;
}
