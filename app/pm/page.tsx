import type { Metadata } from "next";
import PmDashboard from "./dashboard.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "PM dashboard | Gripp",
  description: "Managementdashboard met omzet, billableheid en omzet per uur uit Gripp."
};

export default function PmDashboardPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PmDashboard searchParams={searchParams} />;
}
