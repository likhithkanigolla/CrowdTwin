/**
 * CrowdSimulator.js
 * 
 * A pure MapLibre-native crowd simulation engine.
 * Agents are GeoJSON Point features animated on MapLibre's own layers.
 * This guarantees perfect integration, visibility, and performance.
 */

import { NavigationGraph } from './NavigationGraph';

const MAX_AGENTS = 4000;
const AGENT_SPEED_MS = 0.00000003; // Much slower walking speed
const SCHEDULE_FOLLOW_RATIO = 0.80; // 80% follow schedule, 20% keep moving

// Cohort definitions with colors encoded as MapLibre CSS strings
export const COHORTS = [
  { id: 'ug1',     name: 'UG1 Student',     color: '#ef4444', darkColor: '#dc2626', count: 60 },
  { id: 'ug2',     name: 'UG2 Student',     color: '#3b82f6', darkColor: '#2563eb', count: 55 },
  { id: 'ug3',     name: 'UG3 Student',     color: '#10b981', darkColor: '#059669', count: 50 },
  { id: 'ug4',     name: 'UG4 Student',     color: '#f59e0b', darkColor: '#d97706', count: 40 },
  { id: 'faculty', name: 'Faculty',          color: '#e2e8f0', darkColor: '#94a3b8', count: 20 },
  { id: 'staff',   name: 'Staff',           color: '#a78bfa', darkColor: '#7c3aed', count: 15 },
];

// Default schedule (will be overridden by backend if available)
const DEFAULT_SCHEDULES = {
  ug1:     { 0:'hostel',7:'hostel',8:'academic',12:'canteen',13:'academic',17:'recreation',19:'canteen',21:'hostel' },
  ug2:     { 0:'hostel',8:'canteen',9:'academic',12:'canteen',14:'academic',16:'recreation',20:'hostel',22:'academic' },
  ug3:     { 0:'hostel',9:'academic',13:'canteen',14:'academic',18:'hostel',20:'canteen',22:'academic' },
  ug4:     { 0:'hostel',10:'academic',14:'hostel',16:'recreation',19:'canteen',21:'hostel' },
  faculty: { 0:'admin',8:'gate',9:'academic',13:'admin',14:'academic',17:'gate',18:'admin' },
  staff:   { 0:'admin',6:'gate',7:'canteen',10:'academic',14:'canteen',16:'gate',17:'admin' },
};

let SCHEDULES = DEFAULT_SCHEDULES;
let SCHEDULE_BY_TIME = {}; // Will store backend schedule data

export function setSchedules(schedules, scheduleByTime) {
  SCHEDULES = schedules || DEFAULT_SCHEDULES;
  SCHEDULE_BY_TIME = scheduleByTime || {};
}

function getScheduledCategory(cohortId, hour) {
  const sched = SCHEDULES[cohortId] || SCHEDULES.ug1;
  const keys = Object.keys(sched).map(Number).sort((a,b) => a-b);
  let target = keys[0];
  for (const k of keys) { if (hour >= k) target = k; }
  return sched[target];
}

function getScheduledBuilding(cohortId, hour) {
  // Try to find scheduled venue from backend schedule
  const timeKey = `${String(hour).padStart(2, '0')}:00`;
  if (SCHEDULE_BY_TIME[timeKey] && SCHEDULE_BY_TIME[timeKey][cohortId]) {
    return SCHEDULE_BY_TIME[timeKey][cohortId];
  }
  return null;
}

// Find the current active schedule slot for a cohort at a given time (in hours, e.g. 8.5 = 8:30)
function getCurrentScheduleSlot(cohortId, simTime) {
  const timeKeys = Object.keys(SCHEDULE_BY_TIME).sort();
  let bestSlot = null;
  
  for (const timeKey of timeKeys) {
    const slotData = SCHEDULE_BY_TIME[timeKey]?.[cohortId];
    if (!slotData) continue;
    
    // Parse start and end times
    const startParts = slotData.start_time?.split(':') || [];
    const endParts = slotData.end_time?.split(':') || [];
    
    if (startParts.length < 2 || endParts.length < 2) continue;
    
    const startHour = parseInt(startParts[0], 10) + parseInt(startParts[1], 10) / 60;
    const endHour = parseInt(endParts[0], 10) + parseInt(endParts[1], 10) / 60;
    
    // Check if current simTime falls within this slot
    if (simTime >= startHour && simTime < endHour) {
      // Keep the most recent applicable slot (in case of overlaps)
      if (!bestSlot || startHour > bestSlot.startHour) {
        bestSlot = {
          ...slotData,
          startHour,
          endHour,
          timeKey
        };
      }
    }
  }
  
  return bestSlot;
}

// Check if we have any CSV schedule loaded
function hasCSVSchedule() {
  return Object.keys(SCHEDULE_BY_TIME).length > 0;
}

// Calculate when agent should leave building (in game time hours)
function getScheduleEndTime(cohortId, simTime) {
  const slot = getCurrentScheduleSlot(cohortId, simTime);
  if (slot) {
    return slot.endHour;
  }
  // Default: stay for 1 hour
  return simTime + 1;
}

function getBuildingStayDuration(venueInfo) {
  if (!venueInfo || !venueInfo.duration_minutes) return 60 * 1000; // Default 60 seconds = 60 minutes game time
  return venueInfo.duration_minutes * 1000; // Convert to milliseconds
}


// Helper to check if point is inside a polygon (ray casting algorithm)
function isPointInFocusArea(point, focusArea) {
  if (!focusArea || !focusArea.length || focusArea.length < 3) return true; // No focus area = allow all
  
  const [lng, lat] = point;
  let inside = false;
  
  for (let i = 0, j = focusArea.length - 1; i < focusArea.length; j = i++) {
    const [xi, yi] = focusArea[i];
    const [xj, yj] = focusArea[j];
    
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
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
    this.focusArea = null; // Selected polygon area for constraining movement
  }

  init(map, pathwaysGeoJSON, buildingsGeoJSON, selectedArea = null) {
    this.map = map;
    
    // Store focus area for constraining agent movement
    // selectedArea is { points: [{lat, lng}] } format
    // Convert to [[lng, lat]] format for point-in-polygon test
    const points = selectedArea?.points || selectedArea;
    if (points && Array.isArray(points) && points.length >= 3) {
      this.focusArea = points.map(p => [p.lng, p.lat]);
    } else {
      this.focusArea = null;
    }

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
    
    // Filter to only buildings inside focus area
    const validBuildings = this.focusArea && this.focusArea.length >= 3
      ? list.filter(b => {
          const center = b.properties?.center;
          if (!center) return false;
          return isPointInFocusArea(center, this.focusArea);
        })
      : list;
    
    if (validBuildings.length === 0) return null;
    return validBuildings[Math.floor(Math.random() * validBuildings.length)];
  }

  // Get a completely random building for non-schedule followers
  _getRandomBuilding() {
    if (!this.buildings || this.buildings.length === 0) return null;
    
    // Filter to only buildings inside focus area
    const validBuildings = this.focusArea && this.focusArea.length >= 3
      ? this.buildings.filter(b => {
          const center = b.properties?.center;
          if (!center) return false;
          return isPointInFocusArea(center, this.focusArea);
        })
      : this.buildings;
    
    if (validBuildings.length === 0) return null;
    return validBuildings[Math.floor(Math.random() * validBuildings.length)];
  }

  // Calculate stay duration based on schedule - returns END TIME in game hours (simTime)
  // Schedule followers stay until the schedule slot ends
  _getScheduleBasedStayDuration(cohortId, currentSimTime) {
    // First try to use actual CSV schedule
    const slot = getCurrentScheduleSlot(cohortId, currentSimTime);
    if (slot && slot.endHour) {
      console.log(`Agent ${cohortId} should stay until ${slot.endHour.toFixed(2)} (current: ${currentSimTime.toFixed(2)}), venue: ${slot.venue}`);
      return slot.endHour; // Return end time in game hours
    }
    
    // Fall back to simple schedule
    const sched = SCHEDULES[cohortId] || SCHEDULES.ug1;
    const keys = Object.keys(sched).map(Number).sort((a, b) => a - b);
    
    // Find next schedule change hour
    let nextChangeHour = 24; // Default to end of day
    for (const k of keys) {
      if (k > currentSimTime) {
        nextChangeHour = k;
        break;
      }
    }
    
    return nextChangeHour; // Return end time in game hours
  }

  // Check if schedule changed and agent needs to move
  _shouldAgentMove(agent, currentSimTime) {
    if (!agent.followsSchedule) return true; // Non-schedule followers always move
    
    // Check if current schedule slot has ended
    if (agent.insideUntilSimTime !== undefined && currentSimTime < agent.insideUntilSimTime) {
      return false; // Stay inside until scheduled end time
    }
    
    // Schedule slot ended - check if there's a new destination
    const prevCategory = getScheduledCategory(agent.cohortId, Math.floor(agent.lastScheduleHour || 0));
    const currentCategory = getScheduledCategory(agent.cohortId, Math.floor(currentSimTime));
    
    return prevCategory !== currentCategory || currentSimTime >= (agent.insideUntilSimTime || 0);
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

        // 80% of agents follow schedule, 20% keep moving
        const followsSchedule = Math.random() < SCHEDULE_FOLLOW_RATIO;

        // Occasionally vary destination for realism (only non-schedule followers)
        if (!followsSchedule && Math.random() > 0.7) {
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
        const groupId = `group_${Date.now()}_${Math.random()}`;

        // Create a small group of 2-4 people
        const groupSize = 2 + Math.floor(Math.random() * 3);
        for (let g = 0; g < groupSize; g++) {
          // Schedule followers start INSIDE their scheduled building
          const isInside = followsSchedule && Math.random() > 0.3; // 70% of schedule followers start inside
          
          this.agents.push({
            id: `agent_${Date.now()}_${Math.random()}`,
            cohortId: cohort.id,
            color: cohort.color,
            path: pathPoints.slice(pathIndex),
            pathIndex: 0,
            lng: isInside ? startBuilding.properties.center[0] + (Math.random() - 0.5) * 0.00002 : startPos.lng + (Math.random() - 0.5) * 0.00002,
            lat: isInside ? startBuilding.properties.center[1] + (Math.random() - 0.5) * 0.00002 : startPos.lat + (Math.random() - 0.5) * 0.00002,
            progress: Math.random() * 0.5,
            speed: AGENT_SPEED_MS * (0.7 + Math.random() * 0.6),
            walkPhase: Math.random() * Math.PI * 2,
            state: isInside ? 'INSIDE' : 'MOVING',
            targetBuilding: startBuilding,
            currentBuilding: isInside ? startBuilding : null,
            insideUntil: (isInside && !followsSchedule) ? performance.now() + 5000 : null,
            insideUntilSimTime: (isInside && followsSchedule) ? this._getScheduleBasedStayDuration(cohort.id, this.simTime) : null,
            groupId: groupId,
            followsSchedule: followsSchedule,
            lastScheduleHour: this.simTime
          });
        }
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
          
          // Skip if outside focus area
          if (this.focusArea && this.focusArea.length >= 3 && !isPointInFocusArea([lng, lat], this.focusArea)) {
            continue;
          }

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
            isStationary: true,
            state: 'MOVING',
            targetBuilding: null,
            currentBuilding: null,
            insideUntil: null,
            insideUntilSimTime: null,
            groupId: null,
            followsSchedule: false,
            lastScheduleHour: 0
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

        // Create group of 2-4 people
        const groupSize = 2 + Math.floor(Math.random() * 3);
        const groupId = `group_${Date.now()}_${Math.random()}`;
        const followsSchedule = Math.random() < SCHEDULE_FOLLOW_RATIO;
        
        for (let g = 0; g < groupSize; g++) {
          this.agents.push({
            id: `agent_${Date.now()}_${Math.random()}`,
            cohortId: cohort.id,
            color: cohort.color,
            path: pathPoints,
            pathIndex: 0,
            lng: pathPoints[0].lng + (Math.random() - 0.5) * 0.00002,
            lat: pathPoints[0].lat + (Math.random() - 0.5) * 0.00002,
            progress: 0,
            speed: AGENT_SPEED_MS * (0.7 + Math.random() * 0.6), // variation in walking speed
            walkPhase: Math.random() * Math.PI * 2,
            state: 'MOVING',
            targetBuilding: b2,
            currentBuilding: null,
            insideUntil: null,
            insideUntilSimTime: null,
            groupId: groupId,
            followsSchedule: followsSchedule,
            lastScheduleHour: this.simTime
          });
        }
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
    const currentHour = Math.floor(this.simTime);
    
    this.agents.forEach((agent, idx) => {
      // Handle INSIDE state
      if (agent.state === 'INSIDE') {
        // Schedule followers check if schedule slot has ended (using game time)
        if (agent.followsSchedule) {
          const shouldMove = this._shouldAgentMove(agent, this.simTime);
          if (shouldMove) {
            // Schedule slot ended - time to move to new location
            const newCategory = getScheduledCategory(agent.cohortId, currentHour);
            const newTarget = this._getBuildingForCategory(newCategory);

            if (newTarget && newTarget !== agent.currentBuilding) {
              const pathPoints = this.navGraph.findPath(
                { lng: agent.lng, lat: agent.lat },
                { lng: newTarget.properties.center[0], lat: newTarget.properties.center[1] }
              );

              if (pathPoints.length > 1) {
                agent.path = pathPoints;
                agent.pathIndex = 0;
                agent.state = 'MOVING';
                agent.targetBuilding = newTarget;
                agent.lastScheduleHour = currentHour;
                console.log(`Agent ${agent.cohortId} leaving building at simTime ${this.simTime.toFixed(2)}, scheduled until ${agent.insideUntilSimTime?.toFixed(2)}`);
              }
            }
          }
        } else {
          // Non-schedule followers exit after short time (wall clock based)
          // They can go to ANY random building
          if (performance.now() > agent.insideUntil) {
            // Get a random building from all available buildings
            const newTarget = this._getRandomBuilding();

            if (newTarget && newTarget !== agent.currentBuilding) {
              const pathPoints = this.navGraph.findPath(
                { lng: agent.lng, lat: agent.lat },
                { lng: newTarget.properties.center[0], lat: newTarget.properties.center[1] }
              );

              if (pathPoints.length > 1) {
                agent.path = pathPoints;
                agent.pathIndex = 0;
                agent.state = 'MOVING';
                agent.targetBuilding = newTarget;
              }
            }
          }
        }
        return; // Skip movement update while INSIDE
      }

      // MOVING state logic
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
          // Reached destination → enter building
          agent.state = 'INSIDE';
          agent.currentBuilding = agent.targetBuilding;
          agent.lastScheduleHour = this.simTime;
          
          // Schedule followers stay until schedule slot ends (game time based)
          // Non-followers stay briefly then move again (wall clock based)
          if (agent.followsSchedule) {
            agent.insideUntilSimTime = this._getScheduleBasedStayDuration(agent.cohortId, this.simTime);
            agent.insideUntil = null; // Not used for schedule followers
          } else {
            agent.insideUntil = performance.now() + (2000 + Math.random() * 4000); // 2-6 seconds
            agent.insideUntilSimTime = null;
          }
        }
      } else {
        // Move toward waypoint
        const ratio = step / dist;
        agent.lng += dlng * ratio;
        agent.lat += dlat * ratio;
        // Store facing angle for emoji rotation
        agent.angle = Math.atan2(dlat, dlng);
      }
    });

    // Remove agents that have completed their paths
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.agents.splice(toRemove[i], 1);
    }

    // Update MapLibre GeoJSON layer with visible agents
    this._updateLayer();

    // Update GLTF 3D model instances (if ModelLayer attached)
    if (this.modelLayer) {
      this.modelLayer.updateAgents(this.agents);
    }
  }

  _updateLayer() {
    if (!this.map || !this.map.getSource('crowd-agents')) return;

    // Only render agents that are MOVING (hide INSIDE agents)
    // Also filter to only show agents within focus area
    const visibleAgents = this.agents.filter(a => {
      if (a.state === 'INSIDE') return false;
      // If focus area is defined, only show agents inside it
      if (this.focusArea && this.focusArea.length >= 3) {
        return isPointInFocusArea([a.lng, a.lat], this.focusArea);
      }
      return true;
    });

    const features = visibleAgents.map(agent => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [agent.lng, agent.lat]
      },
      properties: {
        cohortId: agent.cohortId,
        color: agent.color,
        icon: this._getHumanEmoji(agent.cohortId)
      }
    }));

    this.map.getSource('crowd-agents').setData({
      type: 'FeatureCollection',
      features
    });
  }

_getHumanEmoji(cohortId) {
  const EMOJIS = ['🚶','🚶‍♂️','🚶‍♀️'];
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

  _createLayers() {
    if (this.map.getSource('crowd-agents')) return;

    this.map.addSource('crowd-agents', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    this.map.addLayer({
      id: 'crowd-agents-layer',
      type: 'symbol',
      source: 'crowd-agents',
      layout: {
        'text-field': ['get', 'icon'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14, 10,
          18, 16
        ],
        'text-allow-overlap': true,
        'text-keep-upright': true
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-opacity': 0.95
      }
    });
  }
}
