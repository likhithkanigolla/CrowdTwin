// Overpass API helpers — extract roads (highways) and buildings within a radius
// around a center point. Returns normalized JS objects, no deps.
//
// All requests go to overpass-api.de. We keep the timeout short so the UI
// doesn't freeze. Callers should handle the rejection.

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

async function runOverpass(query, signal) {
  const payload = "data=" + encodeURIComponent(query.trim());
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  let lastError = null;

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: payload,
        headers,
        signal,
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

      const data = await res.json();
      if (!data || typeof data !== "object") {
        throw new Error("Invalid Overpass response");
      }
      return data;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to reach Overpass API");
}

// Centroid of an array of [lat,lng] (or {lat,lng}) points.
export function centroid(points) {
  if (!points?.length) return null;
  let lat = 0, lng = 0;
  for (const p of points) {
    if (Array.isArray(p)) { lat += p[0]; lng += p[1]; }
    else { lat += p.lat; lng += p.lng; }
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

// Fetch roads (drivable highways) within `radius` meters of center.
// Returns: [{ id, name, type, coords:[{lat,lng}, ...], midpoint:{lat,lng} }]
export async function fetchRoads(center, radiusMeters = 400, signal) {
  const q = `
    [out:json][timeout:20];
    (
      way(around:${radiusMeters},${center.lat},${center.lng})
        ["highway"~"^(primary|secondary|tertiary|residential|service|unclassified|living_street|trunk)$"];
    );
    out tags geom;
  `;
  const data = await runOverpass(q, signal);
  return (data.elements || []).map((el) => {
    const coords = (el.geometry || []).map((g) => ({ lat: g.lat, lng: g.lon }));
    return {
      id: `road-${el.id}`,
      osmId: el.id,
      name: el.tags?.name || el.tags?.ref || `${el.tags?.highway || "road"} #${el.id}`,
      type: el.tags?.highway,
      coords,
      midpoint: centroid(coords),
    };
  }).filter((r) => r.coords.length >= 2);
}

// Fetch building footprints within `radius` meters of center.
// Returns: [{ id, name, coords:[{lat,lng}], center:{lat,lng} }]
export async function fetchBuildings(center, radiusMeters = 400, signal) {
  const q = `
    [out:json][timeout:20];
    (
      way(around:${radiusMeters},${center.lat},${center.lng})["building"];
      relation(around:${radiusMeters},${center.lat},${center.lng})["building"];
    );
    out tags geom;
  `;
  const data = await runOverpass(q, signal);
  return (data.elements || []).map((el) => {
    let coords = [];
    if (el.geometry) coords = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
    else if (el.members) {
      // relation: flatten member geometries
      for (const m of el.members) {
        if (m.geometry) coords = coords.concat(m.geometry.map((g) => ({ lat: g.lat, lng: g.lon })));
      }
    }
    return {
      id: `bld-osm-${el.id}`,
      osmId: el.id,
      name: el.tags?.name || el.tags?.["addr:housename"] || `Building #${el.id}`,
      tags: el.tags || {},
      coords,
      center: centroid(coords),
    };
  }).filter((b) => b.center && b.coords.length >= 3);
}

// Linear interpolation along a polyline at fraction t (0..1).
// Used to place gates "on" a road at a chosen position.
export function pointAlong(coords, t = 0.5) {
  if (!coords?.length) return null;
  if (coords.length === 1) return coords[0];
  // total length in degrees (good enough for short campus roads)
  const segs = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const d = Math.hypot(b.lat - a.lat, b.lng - a.lng);
    segs.push(d); total += d;
  }
  if (total === 0) return coords[0];
  let target = t * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const f = segs[i] === 0 ? 0 : target / segs[i];
      const a = coords[i], b = coords[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
    }
    target -= segs[i];
  }
  return coords[coords.length - 1];
}
