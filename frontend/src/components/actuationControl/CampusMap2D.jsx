import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const LIGHT_RASTER_TILES = [
  "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
];

const DARK_RASTER_TILES = [
  "https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png",
];

const FALLBACK_RASTER_TILES = [
  "https://tile.openstreetmap.de/{z}/{x}/{y}.png",
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];

function buildRasterStyle(tiles, backgroundColor, maxzoom = 19) {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom,
        attribution: 'OpenStreetMap contributors, CARTO, Esri',
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": backgroundColor } },
      { id: "basemap", type: "raster", source: "basemap" },
    ],
  };
}

const LIGHT_STYLE = buildRasterStyle(LIGHT_RASTER_TILES, "#e8edf4", 19);
const DARK_STYLE = buildRasterStyle(DARK_RASTER_TILES, "#1f2937", 16);
const FALLBACK_STYLE = buildRasterStyle(FALLBACK_RASTER_TILES, "#e8edf4", 19);

function cloneStyle(styleObject) {
  return JSON.parse(JSON.stringify(styleObject));
}

function mapStyleForTheme(themeMode) {
  return cloneStyle(themeMode === "dark" ? DARK_STYLE : LIGHT_STYLE);
}

function normalizePoint(point, fallback) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return {
    lat: Number.isFinite(lat) ? lat : fallback.lat,
    lng: Number.isFinite(lng) ? lng : fallback.lng,
  };
}

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatCoord(value, digits = 5) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}

const STATUS_COLOR = {
  green: "hsl(152, 72%, 50%)",
  yellow: "hsl(42, 96%, 60%)",
  red: "hsl(0, 84%, 62%)",
};

function pinHtml({ label, color, glyph }) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;transform:translateY(-4px)">
      <div style="
        width:28px;height:28px;border-radius:50%;
        background:${color};
        box-shadow: 0 0 0 3px rgba(255,255,255,0.85), 0 6px 14px rgba(0,0,0,0.35);
        display:flex;align-items:center;justify-content:center;
        color:#0b1220;font-weight:700;font-size:12px;
      ">${glyph}</div>
      <div style="
        font-size:10px;font-weight:600;color:#0b1220;
        background:rgba(255,255,255,0.92);padding:2px 6px;border-radius:4px;
        box-shadow:0 2px 6px rgba(0,0,0,0.18);white-space:nowrap;max-width:160px;
        overflow:hidden;text-overflow:ellipsis;
      ">${label}</div>
    </div>`;
}

const ROADS_SOURCE = "ct-roads";
const ROADS_LAYER = "ct-roads-line";
const ROADS_HL_LAYER = "ct-roads-hl";
const BLD_SOURCE = "ct-buildings";
const BLD_FILL_LAYER = "ct-buildings-fill";
const BLD_LINE_LAYER = "ct-buildings-line";

export default function CampusMap2D({
  center,
  zoom = 16.5,
  buildings = [],         // configured campus buildings (markers)
  gates = [],
  displays = [],
  themeMode = "light",
  onMapClick,
  roads = [],             // OSM roads to render as lines
  osmBuildings = [],      // OSM building footprints (polygons)
  highlightRoadId = null,
  onRoadClick,
  onBuildingClick,
  onRenderIssue,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const fallbackLevelRef = useRef(0);
  const styleLoadedRef = useRef(false);
  const styleWatchdogRef = useRef(null);
  const activeThemeRef = useRef(themeMode);
  const onClickRef = useRef(onMapClick);
  const onRoadClickRef = useRef(onRoadClick);
  const onBldClickRef = useRef(onBuildingClick);
  const onIssueRef = useRef(onRenderIssue);
  const safeCenter = normalizePoint(center, { lng: 78.3487, lat: 17.4464 });

  onClickRef.current = onMapClick;
  onRoadClickRef.current = onRoadClick;
  onBldClickRef.current = onBuildingClick;
  onIssueRef.current = onRenderIssue;

  const startStyleWatchdog = (map) => {
    if (styleWatchdogRef.current) clearTimeout(styleWatchdogRef.current);
    styleWatchdogRef.current = setTimeout(() => {
      if (styleLoadedRef.current || fallbackLevelRef.current > 0) return;
      fallbackLevelRef.current = 1;
      onIssueRef.current?.("Primary map style timed out. Switched to fallback.");
      map.setStyle(cloneStyle(FALLBACK_STYLE));
    }, 7000);
  };

  // init once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    activeThemeRef.current = themeMode;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleForTheme(themeMode),
      center: [safeCenter.lng, safeCenter.lat],
      zoom,
      attributionControl: true,
    });

    startStyleWatchdog(map);

    map.on("style.load", () => {
      styleLoadedRef.current = true;
      onIssueRef.current?.(null);
      if (styleWatchdogRef.current) clearTimeout(styleWatchdogRef.current);
    });

    map.on("error", (event) => {
      const message = String(event?.error?.message || "");
      onIssueRef.current?.(message || "Map rendering error");
      const isTileOrStyleFailure = /Failed to load|NetworkError|403|404|429|500|502|503|504|timeout|ERR_/i.test(message);
      if (!isTileOrStyleFailure) return;

      // Only fail over if the main style never became usable.
      if (!styleLoadedRef.current && fallbackLevelRef.current === 0) {
        fallbackLevelRef.current = 1;
        map.setStyle(cloneStyle(FALLBACK_STYLE));
      }
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.on("click", (e) => {
      // Layer-specific click handlers run first via queryRenderedFeatures
      const features = map.queryRenderedFeatures(e.point, {
        layers: [ROADS_LAYER, BLD_FILL_LAYER].filter((l) => map.getLayer(l)),
      });
      const road = features.find((f) => f.layer.id === ROADS_LAYER);
      const bld = features.find((f) => f.layer.id === BLD_FILL_LAYER);
      if (road) {
        onRoadClickRef.current?.(road.properties);
        return;
      }
      if (bld) {
        onBldClickRef.current?.(bld.properties);
        return;
      }
      onClickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    mapRef.current = map;
    return () => {
      if (styleWatchdogRef.current) clearTimeout(styleWatchdogRef.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme switch
  useEffect(() => {
    if (!mapRef.current) return;

    // Avoid resetting style when the requested theme is already active.
    if (activeThemeRef.current === themeMode) {
      return;
    }

    fallbackLevelRef.current = 0;
    styleLoadedRef.current = false;
    activeThemeRef.current = themeMode;
    mapRef.current.setStyle(mapStyleForTheme(themeMode), { diff: false });
    startStyleWatchdog(mapRef.current);
  }, [themeMode]);

  // recenter
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({ center: [safeCenter.lng, safeCenter.lat], zoom, speed: 0.8 });
  }, [safeCenter.lat, safeCenter.lng, zoom]);

  // roads + osm buildings as map sources/layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.isStyleLoaded()) return;

      // roads
      const roadFc = {
        type: "FeatureCollection",
        features: roads
          .map((r) => {
            const coords = (Array.isArray(r?.coords) ? r.coords : [])
              .map((c) => [toFinite(c?.lng), toFinite(c?.lat)])
              .filter(([lng, lat]) => lng !== null && lat !== null);
            if (coords.length < 2) return null;
            return {
              type: "Feature",
              properties: { id: r.id, name: r.name, type: r.type, osmId: r.osmId },
              geometry: { type: "LineString", coordinates: coords },
            };
          })
          .filter(Boolean),
      };

      try {
        if (map.getSource(ROADS_SOURCE)) {
          map.getSource(ROADS_SOURCE).setData(roadFc);
        } else {
          map.addSource(ROADS_SOURCE, { type: "geojson", data: roadFc });
          map.addLayer({
            id: ROADS_LAYER, source: ROADS_SOURCE, type: "line",
            paint: {
              "line-color": "hsl(196, 100%, 55%)",
              "line-width": 4,
              "line-opacity": 0.55,
            },
          });
          map.addLayer({
            id: ROADS_HL_LAYER, source: ROADS_SOURCE, type: "line",
            paint: { "line-color": "hsl(42, 96%, 60%)", "line-width": 6, "line-opacity": 0.95 },
            filter: ["==", ["get", "id"], "__none__"],
          });
        }
      } catch {
        // Ignore style-timing races and retry on subsequent styledata.
      }

      if (map.getLayer(ROADS_HL_LAYER)) {
        map.setFilter(ROADS_HL_LAYER, ["==", ["get", "id"], highlightRoadId || "__none__"]);
      }

      // OSM building footprints
      const bldFc = {
        type: "FeatureCollection",
        features: osmBuildings
          .map((b) => {
            const poly = (Array.isArray(b?.coords) ? b.coords : [])
              .map((c) => [toFinite(c?.lng), toFinite(c?.lat)])
              .filter(([lng, lat]) => lng !== null && lat !== null);
            if (poly.length < 3) return null;
            return {
              type: "Feature",
              properties: { id: b.id, name: b.name, osmId: b.osmId },
              geometry: { type: "Polygon", coordinates: [poly] },
            };
          })
          .filter(Boolean),
      };

      try {
        if (map.getSource(BLD_SOURCE)) {
          map.getSource(BLD_SOURCE).setData(bldFc);
        } else {
          map.addSource(BLD_SOURCE, { type: "geojson", data: bldFc });
          map.addLayer({
            id: BLD_FILL_LAYER, source: BLD_SOURCE, type: "fill",
            paint: { "fill-color": "hsl(175, 84%, 50%)", "fill-opacity": 0.18 },
          });
          map.addLayer({
            id: BLD_LINE_LAYER, source: BLD_SOURCE, type: "line",
            paint: { "line-color": "hsl(175, 84%, 50%)", "line-width": 1.2, "line-opacity": 0.65 },
          });
        }
      } catch {
        // Ignore style-timing races and retry on subsequent styledata.
      }
    };

    apply();
    map.on("styledata", apply);
    return () => map.off("styledata", apply);
  }, [roads, osmBuildings, highlightRoadId]);

  // markers
  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const add = (item, glyph, color, label) => {
      const lat = toFinite(item?.lat);
      const lng = toFinite(item?.lng);
      if (lat === null || lng === null) return;

      const el = document.createElement("div");
      el.innerHTML = pinHtml({ label: String(label || glyph), color, glyph });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([lng, lat])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setHTML(
          `<strong>${String(label || glyph)}</strong><br/><span style="opacity:.7">${formatCoord(lat)}, ${formatCoord(lng)}</span>`
        ))
        .addTo(mapRef.current);
      markersRef.current.push(marker);
    };

    buildings.forEach((b) => add(b, "B", "#7dd3fc", b.name));
    displays.forEach((d) => add(d, "D", "#a78bfa", d.name));
    gates.forEach((g) => add(g, "G", STATUS_COLOR[g.derivedRoadStatus] || "#94a3b8", g.name));
  }, [buildings, gates, displays]);

  // resize on container changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !containerRef.current) return;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}
