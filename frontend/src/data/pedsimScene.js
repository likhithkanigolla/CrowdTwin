export const PEDSIM_SCENE_CENTER = {
  lng: 78.3487,
  lat: 17.4464,
};

export const PEDSIM_SCENE_SCALE = 0.00003;

const WAYPOINTS = {
  w1: [-160, -51],
  w11: [-112, -2],
  w2: [163, -55],
  w22: [112, -2],
  w23: [165, -120],
  w3: [0, -120],
  wstr: [12, -68],
  wstl: [-12, -68],
  wsr: [17, 0],
  wsl: [-17, 0],
  wst: [0, -17],
  wsb: [0, 17],
  w4: [0, 110],
  wr1: [20, -142],
  wr2: [150, -142],
};

const toGeoPoint = ([x, y]) => [
  PEDSIM_SCENE_CENTER.lng + (x * PEDSIM_SCENE_SCALE),
  PEDSIM_SCENE_CENTER.lat - (y * PEDSIM_SCENE_SCALE),
];

const segment = (a, b, properties = {}) => ({
  type: 'Feature',
  properties,
  geometry: {
    type: 'LineString',
    coordinates: [toGeoPoint(a), toGeoPoint(b)],
  },
});

const polygon = (points, properties = {}) => ({
  type: 'Feature',
  properties,
  geometry: {
    type: 'Polygon',
    coordinates: [[...points.map(toGeoPoint), toGeoPoint(points[0])]],
  },
});

const point = (coords, properties = {}) => ({
  type: 'Feature',
  properties,
  geometry: {
    type: 'Point',
    coordinates: toGeoPoint(coords),
  },
});

const obstacleSquares = [
  { id: 'pillar_1', points: [[-2, -50], [2, -50], [2, -46], [-2, -46]], kind: 'building' },
  { id: 'pillar_2', points: [[-2, -70], [2, -70], [2, -66], [-2, -66]], kind: 'building' },
  { id: 'pillar_3', points: [[-2, -30], [2, -30], [2, -26], [-2, -26]], kind: 'building' },
  { id: 'diamond_1', points: [[0, -7], [7, 0], [0, 7], [-7, 0]], kind: 'building' },
];

const wallSegments = [
  [[-20, 120], [-20, 25]],
  [[20, 120], [20, 25]],
  [[-20, 120], [20, 120]],
  [[-20, -150], [-20, -25]],
  [[20, -135], [20, -25]],
  [[-20, -150], [180, -150]],
  [[-100, -15], [-30, -15]],
  [[-120, 15], [-30, 15]],
  [[-30, 15], [-20, 25]],
  [[-30, -15], [-20, -25]],
  [[-150, -65], [-100, -15]],
  [[-180, -45], [-120, 15]],
  [[-180, -45], [-150, -65]],
  [[100, -15], [30, -15]],
  [[120, 15], [30, 15]],
  [[30, 15], [20, 25]],
  [[30, -15], [20, -25]],
  [[150, -65], [100, -15]],
  [[180, -45], [120, 15]],
  [[180, -45], [180, -65]],
  [[180, -65], [170, -85]],
  [[150, -65], [160, -85]],
  [[180, -100], [170, -85]],
  [[150, -100], [160, -85]],
  [[150, -100], [150, -135]],
  [[180, -100], [180, -150]],
  [[150, -135], [20, -135]],
];

const routeSequences = [
  ['w22', 'w2', 'w23', 'wr2', 'wr1', 'w3', 'wstr', 'wsr', 'w4', 'wsr', 'wstr', 'w3', 'wr1', 'wr2', 'w23', 'w2', 'w22', 'wsb', 'w11', 'w1', 'w11', 'wsb'],
  ['w11', 'w1', 'w11', 'wst', 'w22', 'w2', 'w23', 'wr2', 'wr1', 'w3', 'wstl', 'wsl', 'w4', 'wsl', 'wstl', 'w3', 'wr1', 'wr2', 'w23', 'w2', 'w22', 'wst'],
];

export function sceneToGeo(pointCoords) {
  return toGeoPoint(pointCoords);
}

export function buildPedSimSceneGeoJSON() {
  const roadSegments = new Map();

  routeSequences.forEach((sequence) => {
    for (let i = 0; i < sequence.length - 1; i += 1) {
      const startKey = sequence[i];
      const endKey = sequence[i + 1];
      const start = WAYPOINTS[startKey];
      const end = WAYPOINTS[endKey];
      if (!start || !end) continue;

      const key = [startKey, endKey].sort().join('::');
      if (!roadSegments.has(key)) {
        roadSegments.set(key, segment(start, end, {
          id: key,
          road_id: key,
          road_name: `PedSim Route ${roadSegments.size + 1}`,
          road_type: 'pedsim_route',
        }));
      }
    }
  });

  const roads = Array.from(roadSegments.values());
  const obstacles = obstacleSquares.map(({ id, points, kind }) => polygon(points, {
    id,
    name: id.replace(/_/g, ' '),
    kind,
  }));

  const walls = wallSegments.map((coords, index) => segment(coords[0], coords[1], {
    id: `wall_${index + 1}`,
    kind: 'wall',
  }));

  const boundary = polygon([[-180, -150], [180, -150], [180, 120], [-180, 120]], {
    id: 'pedsim_boundary',
    kind: 'boundary',
  });

  const waypoints = Object.entries(WAYPOINTS).map(([id, coords]) => point(coords, {
    id,
    kind: 'waypoint',
  }));

  return {
    boundary: {
      type: 'FeatureCollection',
      features: [boundary],
    },
    obstacles: {
      type: 'FeatureCollection',
      features: obstacles,
    },
    walls: {
      type: 'FeatureCollection',
      features: walls,
    },
    roads: {
      type: 'FeatureCollection',
      features: roads,
    },
    waypoints: {
      type: 'FeatureCollection',
      features: waypoints,
    },
  };
}
