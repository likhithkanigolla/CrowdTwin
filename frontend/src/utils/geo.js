// Geo helpers — Haversine distance + radius lookups.
// Pure JS, no deps. Used by config detection bar and map click handlers.

const R = 6371000; // earth radius in meters
const toRad = (d) => (d * Math.PI) / 180;

export function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function findNearestConfig(point, configs) {
  let best = null;
  let bestDist = Infinity;
  for (const cfg of configs || []) {
    const d = haversineMeters(point, cfg.center);
    if (d < bestDist) {
      bestDist = d;
      best = cfg;
    }
  }
  return best ? { config: best, distance: bestDist, withinRadius: bestDist <= (best.radiusMeters || 0) } : null;
}

export function formatMeters(m) {
  if (!isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function deriveRoadStatus(gate) {
  const a = gate?.sideAStatus === "closed";
  const b = gate?.sideBStatus === "closed";
  if (a && b) return "red";
  if (a || b) return "yellow";
  return "green";
}
