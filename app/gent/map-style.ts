import type { StyleSpecification } from "maplibre-gl";
import { ALICE_BUYSSEHOF_STREET } from "./location-data.js";

// Street centre from the Flemish address register (no house number was specified).
export const GENT_CENTER: [number, number] = [
  3.5487761349497497, 51.031929790964462
];
export const GENT_CAMERA = {
  center: GENT_CENTER,
  zoom: 17.2,
  pitch: 48,
  bearing: -28
};

export type GentPlace = {
  id: string;
  name: string;
  category: string;
  coordinates: [number, number];
};

export const GENT_PLACE_NUMERALS = ["01", "02", "03", "04"];

export const GENT_PLACES: GentPlace[] = [
  {
    id: "alice-buyssehof",
    name: "Alice Buyssehof",
    category: "9850 Nevele",
    coordinates: GENT_CENTER
  },
  {
    id: "nevelemarkt",
    name: "Nevelemarkt",
    category: "Dorpsplein",
    coordinates: [3.549285517758416, 51.0327774527161]
  },
  {
    id: "cyriel-buysse",
    name: "Cyriel Buyssestraat",
    category: "Nevele",
    coordinates: [3.5475915141597625, 51.03236427800865]
  },
  {
    id: "sint-mauritius",
    name: "Sint-Mauritiuskerk",
    category: "Nevelemarkt",
    coordinates: [3.5490587, 51.0333793]
  }
];

// Only visible vector tiles are requested; Three.js reuses their building geometry.
export const GENT_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    address: { type: "geojson", data: ALICE_BUYSSEHOF_STREET },
    city: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution:
        '<a href="https://openfreemap.org/">OpenFreeMap</a> | <a href="https://openmaptiles.org/">OpenMapTiles</a> | <a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a>'
    }
  },
  layers: [
    {
      id: "land",
      type: "background",
      paint: { "background-color": "#f3e9d9" }
    },
    {
      id: "landuse",
      type: "fill",
      source: "city",
      "source-layer": "landuse",
      paint: { "fill-color": "#e8ddcd", "fill-opacity": 0.35 }
    },
    {
      id: "green",
      type: "fill",
      source: "city",
      "source-layer": "landcover",
      filter: ["in", "class", "wood", "grass", "scrub"],
      paint: { "fill-color": "#d9cfbd", "fill-opacity": 0.55 }
    },
    {
      id: "parks",
      type: "fill",
      source: "city",
      "source-layer": "park",
      paint: { "fill-color": "#ded3c3", "fill-opacity": 0.6 }
    },
    {
      id: "water",
      type: "fill",
      source: "city",
      "source-layer": "water",
      paint: { "fill-color": "#a49589", "fill-outline-color": "#827266" }
    },
    {
      id: "waterways",
      type: "line",
      source: "city",
      "source-layer": "waterway",
      paint: {
        "line-color": "#a49589",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 18, 8]
      }
    },
    {
      id: "road-edges",
      type: "line",
      source: "city",
      "source-layer": "transportation",
      filter: ["!in", "class", "rail", "path"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#998a79",
        "line-width": [
          "interpolate",
          ["exponential", 1.5],
          ["zoom"],
          12,
          1.5,
          16,
          9,
          20,
          60
        ]
      }
    },
    {
      id: "roads",
      type: "line",
      source: "city",
      "source-layer": "transportation",
      filter: ["!in", "class", "rail", "path"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#f3e9d9",
        "line-width": [
          "interpolate",
          ["exponential", 1.5],
          ["zoom"],
          12,
          0.8,
          16,
          7,
          20,
          56
        ]
      }
    },
    {
      id: "paths",
      type: "line",
      source: "city",
      "source-layer": "transportation",
      filter: ["==", "class", "path"],
      paint: {
        "line-color": "#a49583",
        "line-width": 2,
        "line-dasharray": [2, 1]
      }
    },
    {
      id: "rail",
      type: "line",
      source: "city",
      "source-layer": "transportation",
      filter: ["==", "class", "rail"],
      paint: {
        "line-color": "#8d8071",
        "line-width": 1.5,
        "line-dasharray": [3, 2]
      }
    },
    {
      id: "address-street",
      type: "line",
      source: "address",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#937050",
        "line-opacity": 0.8,
        "line-width": [
          "interpolate",
          ["exponential", 1.5],
          ["zoom"],
          14,
          3,
          17,
          8,
          19,
          18
        ]
      }
    },
    {
      id: "buildings",
      type: "fill",
      source: "city",
      "source-layer": "building",
      minzoom: 13,
      paint: { "fill-color": "#f0e5d4", "fill-outline-color": "#8d7e6c" }
    },
    {
      id: "street-labels",
      type: "symbol",
      source: "city",
      "source-layer": "transportation_name",
      minzoom: 15,
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name:nl"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-max-angle": 30,
        "symbol-spacing": 300
      },
      paint: {
        "text-color": "#55473d",
        "text-halo-color": "#f3e9d9",
        "text-halo-width": 1
      }
    },
    {
      id: "water-labels",
      type: "symbol",
      source: "city",
      "source-layer": "waterway",
      minzoom: 14,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Italic"],
        "text-size": 12
      },
      paint: {
        "text-color": "#493b34",
        "text-halo-color": "#b6a79b",
        "text-halo-width": 1
      }
    },
    {
      id: "place-labels",
      type: "symbol",
      source: "city",
      "source-layer": "place",
      maxzoom: 15,
      layout: {
        "text-field": ["coalesce", ["get", "name:nl"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 15,
        "text-transform": "uppercase"
      },
      paint: {
        "text-color": "#55473d",
        "text-halo-color": "#f3e9d9",
        "text-halo-width": 2
      }
    }
  ]
};
