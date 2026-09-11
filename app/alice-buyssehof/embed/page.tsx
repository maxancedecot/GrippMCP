import type { Metadata } from "next";
import { GentMap } from "../../gent/gent-map.js";
import { DEFAULT_EMBED_SCENE, parseEmbedScene } from "../../gent/embed-config.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../gent/gent.css";

export const metadata: Metadata = {
  title: "Alice Buyssehof | 3D-kaart",
  description: "Interactieve 3D-omgevingskaart van Alice Buyssehof.",
  robots: { index: false, follow: false }
};

export default async function AliceBuyssehofEmbedPage({ searchParams }: {
  searchParams: Promise<{ scene?: string | string[] }>;
}) {
  const { scene: raw } = await searchParams;
  const scene = raw === undefined ? DEFAULT_EMBED_SCENE : typeof raw === "string" ? parseEmbedScene(raw) : null;
  if (!scene) return (
    <main className="gent-page gent-page--viewer gent-invalid-embed" role="alert">
      <h1>Deze kaartlink is ongeldig</h1>
      <p>Vraag de beheerder om een nieuwe insluitcode voor deze kaart.</p>
    </main>
  );
  return <GentMap key={JSON.stringify(scene)} viewerScene={scene} />;
}
