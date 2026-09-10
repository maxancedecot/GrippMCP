import type { Metadata } from "next";
import { DashboardFrame } from "../dashboard-frame.js";
import { GentMap } from "../gent/gent-map.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "../gent/gent.css";

export const metadata: Metadata = {
  title: "Alice Buyssehof 3D | Ledoux",
  description:
    "Interactieve 3D-omgevingskaart van Alice Buyssehof in Nevele, Deinze."
};

export default function AliceBuyssehofPage() {
  return (
    <DashboardFrame className="gent-app">
      <GentMap />
    </DashboardFrame>
  );
}
