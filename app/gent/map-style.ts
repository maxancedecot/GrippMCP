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

export const GENT_PLACE_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

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
      paint: { "background-color": "#c7cbb5" }
    },
    {
      id: "landuse",
      type: "fill",
      source: "city",
      "source-layer": "landuse",
      paint: { "fill-color": "#b9c0a4", "fill-opacity": 0.6 }
    },
    {
      id: "green",
      type: "fill",
      source: "city",
      "source-layer": "landcover",
      filter: ["in", "class", "wood", "grass", "scrub"],
      paint: { "fill-color": "#849974", "fill-opacity": 0.85 }
    },
    {
      id: "parks",
      type: "fill",
      source: "city",
      "source-layer": "park",
      paint: { "fill-color": "#8b9d78", "fill-opacity": 0.8 }
    },
    {
      id: "water",
      type: "fill",
      source: "city",
      "source-layer": "water",
      paint: { "fill-color": "#547d7c", "fill-outline-color": "#375d5c" }
    },
    {
      id: "waterways",
      type: "line",
      source: "city",
      "source-layer": "waterway",
      paint: {
        "line-color": "#547d7c",
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
        "line-color": "#a5aa91",
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
        "line-color": "#d5d1bb",
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
        "line-color": "#d5d1bb",
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
        "line-color": "#818773",
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
      paint: { "fill-color": "#a59f93", "fill-outline-color": "#736f63" }
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
        "text-color": "#4b4e3b",
        "text-halo-color": "#e0dcc5",
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
        "text-color": "#e4e1c9",
        "text-halo-color": "#3f6363",
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
        "text-color": "#434a36",
        "text-halo-color": "#d5d1bb",
        "text-halo-width": 2
      }
    }
  ]
};
