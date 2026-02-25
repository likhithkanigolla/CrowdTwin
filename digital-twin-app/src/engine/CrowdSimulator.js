/**
 * CrowdSimulator.js
 * 
 * A pure MapLibre-native crowd simulation engine.
 * Agents are GeoJSON Point features animated on MapLibre's own layers.
 * This guarantees perfect integration, visibility, and performance.
 */

import { NavigationGraph } from './NavigationGraph';

const MAX_AGENTS = 2000;
const AGENT_SPEED_MS = 0.000003; // Much slower walking speed

// Cohort definitions with colors encoded as MapLibre CSS strings
export const COHORTS = [
  { id: 'ug1',     name: 'UG1 Student',     color: '#ef4444', darkColor: '#dc2626', count: 60 },
  { id: 'ug2',     name: 'UG2 Student',     color: '#3b82f6', darkColor: '#2563eb', count: 55 },
  { id: 'ug3',     name: 'UG3 Student',     color: '#10b981', darkColor: '#059669', count: 50 },
  { id: 'ug4',     name: 'UG4 Student',     color: '#f59e0b', darkColor: '#d97706', count: 40 },
  { id: 'faculty', name: 'Faculty',          color: '#e2e8f0', darkColor: '#94a3b8', count: 20 },
  { id: 'staff',   name: 'Staff',           color: '#a78bfa', darkColor: '#7c3aed', count: 15 },
];

// Schedule: what area category each cohort is heading to at each hour
const SCHEDULES = {
  ug1:     { 0:'hostel',7:'hostel',8:'academic',12:'canteen',13:'academic',17:'recreation',19:'canteen',21:'hostel' },
  ug2:     { 0:'hostel',8:'canteen',9:'academic',12:'canteen',14:'academic',16:'recreation',20:'hostel',22:'academic' },
  ug3:     { 0:'hostel',9:'academic',13:'canteen',14:'academic',18:'hostel',20:'canteen',22:'academic' },
  ug4:     { 0:'hostel',10:'academic',14:'hostel',16:'recreation',19:'canteen',21:'hostel' },
  faculty: { 0:'admin',8:'gate',9:'academic',13:'admin',14:'academic',17:'gate',18:'admin' },
  staff:   { 0:'admin',6:'gate',7:'canteen',10:'academic',14:'canteen',16:'gate',17:'admin' },
};

function getScheduledCategory(cohortId, hour) {
  const sched = SCHEDULES[cohortId] || SCHEDULES.ug1;
  const keys = Object.keys(sched).map(Number).sort((a,b) => a-b);
  let target = keys[0];
  for (const k of keys) { if (hour >= k) target = k; }
  return sched[target];
}

// Agent polygon geometry — renders agents as small squares instead of dots
function agentPolygon(lng, lat, size = 0.00003) {
  const s = size;
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - s, lat - s],
      [lng + s, lat - s],
      [lng + s, lat + s],
      [lng - s, lat + s],
      [lng - s, lat - s],
    ]],
  };
}

export class CrowdSimulator {
  constructor() {
    this.map = null;
    this.navGraph = null;
    this.agents = [];
    this.buildings = []; // All buildings with center coordinates
    this.categoryMap = {}; // category -> [building]
    this.running = false;
    this.simTime = 7.75;
    this.animFrame = null;
    this.lastTimestamp = null;
    this.spawnCounter = 0;
  }

  init(map, pathwaysGeoJSON, buildingsGeoJSON) {
    this.map = map;

    // Build navigation graph from OSM pathways
    this.navGraph = new NavigationGraph();
    this.navGraph.buildFromGeoJSON(pathwaysGeoJSON);

    // Index buildings by category
    this.buildings = buildingsGeoJSON.features.filter(f => f.properties.center);
    this.categoryMap = {};
    this.buildings.forEach(b => {
      const cat = b.properties.category || 'other';
      if (!this.categoryMap[cat]) this.categoryMap[cat] = [];
      this.categoryMap[cat].push(b);
    });
    // Also add 'other' buildings as fallback for all categories
    const allWithCenter = [...this.buildings];
    if (!this.categoryMap.fallback) this.categoryMap.fallback = allWithCenter;

    console.log(`CrowdSimulator: ${this.buildings.length} buildings, ${this.navGraph.nodes.size} nav nodes`);

    // Create MapLibre sources and layers for agents
    this._createLayers();

    // Populate initial agents at starting simulation time
    this._populateInitialAgents();

    // Start animation loop
    this.running = true;
    this._animate(performance.now());
  }

  setSimTime(t) {
    this.simTime = t;
  }

  stop() {
    this.running = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }

  _getBuildingForCategory(category) {
    const list = this.categoryMap[category] || this.categoryMap['other'] || this.categoryMap.fallback;
    if (!list || list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  _populateInitialAgents() {
    // Spawn initial agent population at starting simulation time
    const hour = Math.floor(this.simTime);
    const initialAgentsPerCohort = 25; // Start with decent population

    COHORTS.forEach(cohort => {
      const srcCategory = getScheduledCategory(cohort.id, hour);
      const dstCategory = getScheduledCategory(cohort.id, hour);

      // Spawn initial agents starting from their current location category
      for (let i = 0; i < initialAgentsPerCohort && this.agents.length < MAX_AGENTS; i++) {
        const startBuilding = this._getBuildingForCategory(srcCategory);
        let endBuilding = this._getBuildingForCategory(dstCategory);
        if (!startBuilding || !endBuilding) continue;

        // Occasionally vary destination for realism
        if (Math.random() > 0.7) {
          endBuilding = this._getBuildingForCategory(dstCategory);
        }

        const startLng = startBuilding.properties.center[0] + (Math.random() - 0.5) * 0.00003;
        const startLat = startBuilding.properties.center[1] + (Math.random() - 0.5) * 0.00003;
        const endLng = endBuilding.properties.center[0] + (Math.random() - 0.5) * 0.00003;
        const endLat = endBuilding.properties.center[1] + (Math.random() - 0.5) * 0.00003;

        const pathPoints = this.navGraph.findPath(
          { lng: startLng, lat: startLat },
          { lng: endLng, lat: endLat }
        );

        if (pathPoints.length < 2) continue;

        // Place agent at a random point along the path to create realistic distribution
        const pathIndex = Math.floor(Math.random() * Math.max(1, pathPoints.length - 2));
        const startPos = pathPoints[pathIndex];

        this.agents.push({
          id: `agent_${Date.now()}_${Math.random()}`,
          cohortId: cohort.id,
          color: cohort.color,
          path: pathPoints.slice(pathIndex),
          pathIndex: 0,
          lng: startPos.lng,
          lat: startPos.lat,
          progress: Math.random() * 0.5,
          speed: AGENT_SPEED_MS * (0.7 + Math.random() * 0.6),
          walkPhase: Math.random() * Math.PI * 2
        });
      }
    });

    console.log(`CrowdSimulator: Initialized ${this.agents.length} agents`);
  }

  populateGreenAreas(greenAreasGeoJSON) {
    // Populate green areas with stationary agents
    const agentsPerPolygon = 80; // Dense coverage
    const stationaryColor = '#10b981'; // Green color for idle agents

    greenAreasGeoJSON.features.forEach(feature => {
      if (feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0];
        
        // Calculate bounding box
        let minLng = Infinity, maxLng = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;
        coords.forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        });

        // Scatter agents within the polygon area
        for (let i = 0; i < agentsPerPolygon && this.agents.length < MAX_AGENTS; i++) {
          const lng = minLng + Math.random() * (maxLng - minLng);
          const lat = minLat + Math.random() * (maxLat - minLat);

          // Create stationary agent (path with same start and end)
          this.agents.push({
            id: `green_agent_${Date.now()}_${Math.random()}`,
            cohortId: 'recreation',
            color: stationaryColor,
            path: [
              { lng, lat },
              { lng: lng + 0.00001, lat: lat + 0.00001 },
              { lng, lat }
            ],
            pathIndex: 0,
            lng: lng,
            lat: lat,
            progress: 0,
            speed: 0.0000001, // Extremely slow - basically stationary
            walkPhase: Math.random() * Math.PI * 2,
            isStationary: true
          });
        }
      }
    });

    console.log(`CrowdSimulator: Populated green areas`);
  }

  _spawnAgentsForTime(hour) {
    if (this.agents.length >= MAX_AGENTS) return;

    const spawnsPerTick = Math.min(12, (MAX_AGENTS - this.agents.length) * 0.1); // ramp up

    COHORTS.forEach(cohort => {
      if (this.agents.length >= MAX_AGENTS) return;

      const prevHour = Math.max(0, hour - 1);
      const srcCat = getScheduledCategory(cohort.id, prevHour);
      const dstCat = getScheduledCategory(cohort.id, hour);
      const isMigrating = srcCat !== dstCat;
      const spawnCount = isMigrating ? 2 : 0; // Only spawn new agents when migrating

      for (let i = 0; i < spawnCount && this.agents.length < MAX_AGENTS; i++) {
        const b1 = this._getBuildingForCategory(srcCat);
        let b2 = this._getBuildingForCategory(dstCat);
        if (!b1 || !b2) continue;

        // Ensure different buildings
        let retries = 0;
        while (b2 === b1 && retries < 10) {
          b2 = this.buildings[Math.floor(Math.random() * this.buildings.length)];
          retries++;
        }
        if (b2 === b1) continue;

        const startLng = b1.properties.center[0] + (Math.random() - 0.5) * 0.00003;
        const startLat = b1.properties.center[1] + (Math.random() - 0.5) * 0.00003;
        const endLng   = b2.properties.center[0] + (Math.random() - 0.5) * 0.00003;
        const endLat   = b2.properties.center[1] + (Math.random() - 0.5) * 0.00003;

        // Get A* path — returns array of {lng, lat}
        const pathPoints = this.navGraph.findPath(
          { lng: startLng, lat: startLat },
          { lng: endLng, lat: endLat }
        );

        if (pathPoints.length < 2) continue;

        this.agents.push({
          id: `agent_${Date.now()}_${Math.random()}`,
          cohortId: cohort.id,
          color: cohort.color,
          path: pathPoints,
          pathIndex: 0,
          lng: pathPoints[0].lng,
          lat: pathPoints[0].lat,
          progress: 0,
          speed: AGENT_SPEED_MS * (0.7 + Math.random() * 0.6), // variation in walking speed
          walkPhase: Math.random() * Math.PI * 2
        });
      }
    });
  }

  _animate(timestamp) {
    if (!this.running) return;
    this.animFrame = requestAnimationFrame(ts => this._animate(ts));

    const dt = this.lastTimestamp ? Math.min(timestamp - this.lastTimestamp, 100) : 16;
    this.lastTimestamp = timestamp;

    // Spawn new agents every ~1s
    this.spawnCounter += dt;
    if (this.spawnCounter > 1000) {
      this.spawnCounter = 0;
      this._spawnAgentsForTime(Math.floor(this.simTime));
    }

    // Update agent positions
    const toRemove = [];
    this.agents.forEach((agent, idx) => {
      const target = agent.path[agent.pathIndex + 1];
      if (!target) { toRemove.push(idx); return; }

      const dlng = target.lng - agent.lng;
      const dlat = target.lat - agent.lat;
      const dist = Math.sqrt(dlng*dlng + dlat*dlat);
      const step = agent.speed * dt;

      if (dist < step || dist < 1e-8) {
        // Reached waypoint, advance
        agent.lng = target.lng;
        agent.lat = target.lat;
        agent.pathIndex++;
        if (agent.pathIndex >= agent.path.length - 1) {
          toRemove.push(idx);
        }
      } else {
        // Move toward waypoint
        const ratio = step / dist;
        agent.lng += dlng * ratio;
        agent.lat += dlat * ratio;
        // Store facing angle for 3D model rotation
        agent.angle = Math.atan2(dlat, dlng);
      }
    });

    // Remove agents that have completed their paths
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.agents.splice(toRemove[i], 1);
    }

    // Update MapLibre GeoJSON layer (circle dots)
    this._updateLayer();

    // Update GLTF 3D model instances (if ModelLayer attached)
    if (this.modelLayer) {
      this.modelLayer.updateAgents(this.agents);
    }
  }

  _updateLayer() {
    if (!this.map || !this.map.getSource('crowd-agents')) return;

    const features = this.agents.map(agent => ({
      type: 'Feature',
      geometry: agentPolygon(agent.lng, agent.lat),
      properties: { cohortId: agent.cohortId, color: agent.color }
    }));

    this.map.getSource('crowd-agents').setData({
      type: 'FeatureCollection',
      features
    });
  }

  _createLayers() {
    if (this.map.getSource('crowd-agents')) return;

    // One GeoJSON source for all agents
    this.map.addSource('crowd-agents', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // Main agent polygon with glow effect
    this.map.addLayer({
      id: 'crowd-agents-glow',
      type: 'fill',
      source: 'crowd-agents',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.3
      }
    });

    // Agent polygon outline
    this.map.addLayer({
      id: 'crowd-agents-dot',
      type: 'line',
      source: 'crowd-agents',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1.5,
        'line-opacity': 0.95
      }
    });
  }
}
