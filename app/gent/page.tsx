import type { Metadata } from "next";
import { DashboardFrame } from "../dashboard-frame.js";
import { GentMap } from "./gent-map.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "./gent.css";

export const metadata: Metadata = {
  title: "Gent 3D | Ledoux",
  description:
    "Een interactieve stadskaart van Gent met 3D-gebouwen en herkenningspunten."
};

export default function GentPage() {
  return (
    <DashboardFrame className="gent-app">
      <GentMap />
    </DashboardFrame>
  );
}
