import type { Metadata } from "next";
import PmDashboard from "../dashboard.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "PM dashboard Lite | Gripp",
  description: "PM-dashboard met omzet en billableheid per medewerker en per maand."
};

export default function PmDashboardLitePage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PmDashboard searchParams={searchParams} lite />;
}
