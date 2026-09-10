import type { StyleSpecification } from "maplibre-gl";

export const GENT_CENTER: [number, number] = [3.723, 51.055];
export const GENT_CAMERA = {
  center: GENT_CENTER,
  zoom: 16.3,
  pitch: 58,
  bearing: -24
};

export type GentPlace = {
  id: string;
  name: string;
  category: string;
  coordinates: [number, number];
};

export const GENT_PLACES: GentPlace[] = [
  {
    id: "gravensteen",
    name: "Gravensteen",
    category: "Burcht",
    coordinates: [3.7206512, 51.0571758]
  },
  {
    id: "graslei",
    name: "Graslei & Korenlei",
    category: "Aan de Leie",
    coordinates: [3.7209302, 51.0547777]
  },
  {
    id: "belfort",
    name: "Belfort",
    category: "Historische toren",
    coordinates: [3.7247914, 51.0536613]
  },
  {
    id: "sint-baafs",
    name: "Sint-Baafskathedraal",
    category: "Kathedraal",
    coordinates: [3.7271875, 51.0529819]
  },
  {
    id: "vrijdagmarkt",
    name: "Vrijdagmarkt",
    category: "Stadsplein",
    coordinates: [3.7257391, 51.0569768]
  },
  {
    id: "portus-ganda",
    name: "Portus Ganda",
    category: "Jachthaven",
    coordinates: [3.7335833, 51.055753]
  },
  {
    id: "sint-pieters",
    name: "Sint-Pietersabdij",
    category: "Abdij & tuin",
    coordinates: [3.7270233, 51.0417785]
  }
];

// Only visible vector tiles are requested; Three.js reuses their building geometry.
export const GENT_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
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
      paint: { "background-color": "#edf0ed" }
    },
    {
      id: "landuse",
      type: "fill",
      source: "city",
      "source-layer": "landuse",
      paint: { "fill-color": "#e3e8e3", "fill-opacity": 0.7 }
    },
    {
      id: "green",
      type: "fill",
      source: "city",
      "source-layer": "landcover",
      filter: ["in", "class", "wood", "grass", "scrub"],
      paint: { "fill-color": "#bfd5bd", "fill-opacity": 0.8 }
    },
    {
      id: "parks",
      type: "fill",
      source: "city",
      "source-layer": "park",
      paint: { "fill-color": "#c3dbbf", "fill-opacity": 0.75 }
    },
    {
      id: "water",
      type: "fill",
      source: "city",
      "source-layer": "water",
      paint: { "fill-color": "#7fbecb" }
    },
    {
      id: "waterways",
      type: "line",
      source: "city",
      "source-layer": "waterway",
      paint: {
        "line-color": "#7fbecb",
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
        "line-color": "#d4d9d3",
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
        "line-color": "#ffffff",
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
        "line-color": "#ffffff",
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
        "line-color": "#a8b4ae",
        "line-width": 1.5,
        "line-dasharray": [3, 2]
      }
    },
    {
      id: "buildings",
      type: "fill",
      source: "city",
      "source-layer": "building",
      minzoom: 13,
      paint: { "fill-color": "#d0d6d4", "fill-outline-color": "#aebbb7" }
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
        "text-color": "#5b6b67",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5
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
        "text-color": "#2e6c7f",
        "text-halo-color": "#a9d4dc",
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
        "text-color": "#536560",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2
      }
    }
  ]
};
