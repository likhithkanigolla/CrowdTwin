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

const stableRandom = (() => {
  let seed = 987654321;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
})();

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
  // For default schedules, find next schedule change
  return getNextScheduleChangeHour(cohortId, simTime);
}

// Find when the schedule changes next (for default schedules without CSV)
function getNextScheduleChangeHour(cohortId, currentSimTime) {
  const sched = SCHEDULES[cohortId] || SCHEDULES.ug1;
  const keys = Object.keys(sched).map(Number).sort((a, b) => a - b);
  const currentCategory = getScheduledCategory(cohortId, Math.floor(currentSimTime));
  
  // Find the next hour where category changes
  for (const k of keys) {
    if (k > currentSimTime && sched[k] !== currentCategory) {
      return k;
    }
  }
  
  // If no more changes today, wrap to tomorrow's first change
  // or stay minimum 1 hour
  return Math.max(currentSimTime + 1, 24);
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
    this.currentMode = 'visualize'; // 'visualize', 'actuate', 'simulate'
    this.roadClosures = new Map(); // roadId -> status ('open', 'soft_closed', 'hard_closed')
    this.simulationSchedule = []; // Custom schedule for simulation mode
    this.isSimulationActive = false; // Whether simulation is running with custom schedule
  }

  /**
   * Set the current operating mode
   * @param {string} mode - 'visualize', 'actuate', or 'simulate'
   */
  setMode(mode) {
    const prevMode = this.currentMode;
    this.currentMode = mode;

    if (mode === 'simulate') {
      // Simulation mode: always start with blank map
      this.clearAgents();
      this.isSimulationActive = false;
      this.roadClosures.clear();
      if (this.navGraph) {
        this.navGraph.blockedRoads.clear();
      }
      console.log('CrowdSimulator: Entered simulation mode - map cleared, blank slate');
    } else if (mode === 'visualize') {
      // Visualization mode: show agents from camera/sensor data
      if (prevMode !== 'visualize') {
        this.clearAgents();
      }
      // Populate agents from API data for visualization only
      this._populateInitialAgents();
      // In visualization mode, agents should be static (moved only on events)
      this.agents.forEach(agent => {
        agent.state = 'STATIONARY';
      });
      this._updateLayer();
      console.log('CrowdSimulator: Entered visualization mode - agents stationary');
    } else if (mode === 'actuate') {
      // Actuation mode: no agents at all (focus on road controls)
      this.clearAgents();
      console.log('CrowdSimulator: Entered actuation mode - no agents, road control only');
    }

    console.log(`CrowdSimulator: Mode changed from ${prevMode} to ${mode}`);
  }

  /**
   * Clear all agents (used when entering simulation mode)
   */
  clearAgents() {
    this.agents = [];
    this._updateLayer();
    console.log('CrowdSimulator: All agents cleared');
  }

  /**
   * Set road closure status
   * @param {string} roadId 
   * @param {string} status - 'open', 'soft_closed', 'hard_closed'
   */
  setRoadClosure(roadId, status) {
    if (status === 'open') {
      this.roadClosures.delete(roadId);
      // Unblock in navigation graph
      if (this.navGraph) {
        this.navGraph.setRoadBlocked(roadId, false);
      }
    } else {
      this.roadClosures.set(roadId, status);
      // Block in navigation graph (both soft and hard closures block pathfinding)
      if (this.navGraph) {
        this.navGraph.setRoadBlocked(roadId, true);
      }
    }
    console.log(`CrowdSimulator: Road ${roadId} set to ${status}`);
    
    // Force agents currently on closed roads to recalculate paths
    if (status !== 'open') {
      this._recalculateBlockedAgentPaths();
    }
  }
  
  /**
   * Recalculate paths for agents that may be on blocked roads
   */
  _recalculateBlockedAgentPaths() {
    this.agents.forEach(agent => {
      if (agent.state === 'MOVING' && agent.targetBuilding) {
        // Recalculate path avoiding blocked roads
        const startLng = agent.lng;
        const startLat = agent.lat;
        const endLng = agent.targetBuilding.properties.center[0];
        const endLat = agent.targetBuilding.properties.center[1];
        
        const newPath = this.navGraph.findPath(
          { lng: startLng, lat: startLat },
          { lng: endLng, lat: endLat }
        );
        
        if (newPath.length >= 2) {
          agent.path = newPath;
          agent.pathIndex = 0;
          agent.progress = 0;
        }
      }
    });
    console.log('CrowdSimulator: Recalculated paths for agents due to road closure');
  }
  
  /**
   * Get all available roads from navigation graph
   */
  getAvailableRoads() {
    if (this.navGraph) {
      return this.navGraph.getAllRoadNames();
    }
    return [];
  }

  /**
   * Update agents from camera data (visualization mode)
   * @param {Object} cameraData - { camera_id, building_id, people_count, positions: [{lat, lng}] }
   */
  updateFromCameraData(cameraData) {
    if (this.currentMode !== 'visualize') return;
    
    // Find the building for this camera
    const building = this.buildings.find(b => 
      b.properties.name === cameraData.building_id || 
      b.properties.id === cameraData.building_id
    );
    
    if (!building) {
      console.warn(`Building not found for camera ${cameraData.camera_id}`);
      return;
    }
    
    const buildingCenter = building.properties.center;
    const newAgentCount = cameraData.people_count || 0;
    
    // Remove existing agents at this building
    this.agents = this.agents.filter(a => 
      a.cameraSource !== cameraData.camera_id
    );
    
    // Add new agents based on camera data
    for (let i = 0; i < newAgentCount; i++) {
      const position = cameraData.positions?.[i] || {
        lng: buildingCenter[0] + (stableRandom() - 0.5) * 0.0002,
        lat: buildingCenter[1] + (stableRandom() - 0.5) * 0.0002
      };
      
      this.agents.push({
        id: `camera_${cameraData.camera_id}_${i}`,
        cohortId: 'unknown', // Can't detect cohort from camera
        color: '#6366f1', // Single color for visualization mode
        path: [position],
        pathIndex: 0,
        lng: position.lng,
        lat: position.lat,
        progress: 0,
        speed: 0,
        state: 'STATIONARY',
        cameraSource: cameraData.camera_id,
        currentBuilding: building
      });
    }
    
    this._updateLayer();
    console.log(`CrowdSimulator: Updated ${newAgentCount} agents from camera ${cameraData.camera_id}`);
  }

  /**
   * Move agents from one location to another (visualization mode - triggered by camera events)
   * @param {string} fromBuildingId 
   * @param {string} toBuildingId 
   * @param {number} count - number of people moving
   */
  moveAgentsBetweenLocations(fromBuildingId, toBuildingId, count) {
    if (this.currentMode !== 'visualize') return;
    
    const fromBuilding = this.buildings.find(b => 
      b.properties.name === fromBuildingId || b.properties.id === fromBuildingId
    );
    const toBuilding = this.buildings.find(b => 
      b.properties.name === toBuildingId || b.properties.id === toBuildingId
    );
    
    if (!fromBuilding || !toBuilding) {
      console.warn(`Buildings not found: ${fromBuildingId} -> ${toBuildingId}`);
      return;
    }
    
    // Get agents at the source building
    const agentsAtSource = this.agents.filter(a => 
      a.currentBuilding?.properties?.name === fromBuildingId ||
      a.currentBuilding?.properties?.id === fromBuildingId
    );
    
    // Move some agents
    const agentsToMove = agentsAtSource.slice(0, count);
    
    agentsToMove.forEach(agent => {
      const pathPoints = this.navGraph.findPath(
        { lng: agent.lng, lat: agent.lat },
        { lng: toBuilding.properties.center[0], lat: toBuilding.properties.center[1] }
      );
      
      if (pathPoints.length >= 2) {
        agent.path = pathPoints;
        agent.pathIndex = 0;
        agent.state = 'MOVING';
        agent.targetBuilding = toBuilding;
        agent.speed = AGENT_SPEED_MS * (0.7 + stableRandom() * 0.6);
      }
    });
    
    console.log(`CrowdSimulator: Moving ${agentsToMove.length} agents from ${fromBuildingId} to ${toBuildingId}`);
  }

  /**
   * Set building occupancy directly from backend data (visualization mode)
   * @param {Object} occupancyData - { building_id, count }
   */
  setBuildingOccupancy(buildingId, count) {
    const building = this.buildings.find(b => 
      b.properties.name === buildingId || b.properties.id === buildingId
    );
    
    if (!building) return;
    
    // Remove existing agents at this building
    this.agents = this.agents.filter(a => 
      a.currentBuilding?.properties?.name !== buildingId &&
      a.currentBuilding?.properties?.id !== buildingId
    );
    
    const buildingCenter = building.properties.center;
    
    // Add agents based on count
    for (let i = 0; i < count; i++) {
      const isInside = stableRandom() > 0.2; // 80% inside building
      
      this.agents.push({
        id: `occ_${buildingId}_${i}`,
        cohortId: 'unknown',
        color: '#6366f1',
        path: [],
        pathIndex: 0,
        lng: buildingCenter[0] + (stableRandom() - 0.5) * 0.0002,
        lat: buildingCenter[1] + (stableRandom() - 0.5) * 0.0002,
        progress: 0,
        speed: 0,
        state: isInside ? 'INSIDE' : 'STATIONARY',
        currentBuilding: building
      });
    }
    
    this._updateLayer();
  }

  /**
   * Start simulation with custom schedule (for simulation mode)
   * @param {Array} schedule - Array of {time, from, to, cohort, count}
   * @param {number} initialPopulation - Starting population
   */
  startCustomSimulation(schedule, initialPopulation = 0) {
    this.simulationSchedule = schedule;
    this.isSimulationActive = true;
    this.clearAgents();

    if (initialPopulation > 0) {
      this._spawnRandomAgents(initialPopulation);
    }

    console.log(`CrowdSimulator: Custom simulation started with ${schedule.length} schedule entries`);
  }

  /**
   * Stop custom simulation
   */
  stopCustomSimulation() {
    this.isSimulationActive = false;
    this.simulationSchedule = [];
    console.log('CrowdSimulator: Custom simulation stopped');
  }

  /**
   * Spawn random agents (for simulation mode)
   */
  _spawnRandomAgents(count) {
    const agentsToSpawn = Math.min(count, MAX_AGENTS - this.agents.length);
    
    for (let i = 0; i < agentsToSpawn; i++) {
      const cohort = COHORTS[Math.floor(stableRandom() * COHORTS.length)];
      const startBuilding = this._getRandomBuilding();
      const endBuilding = this._getRandomBuilding();
      
      if (!startBuilding || !endBuilding) continue;

      const pathPoints = this.navGraph.findPath(
        { lng: startBuilding.properties.center[0], lat: startBuilding.properties.center[1] },
        { lng: endBuilding.properties.center[0], lat: endBuilding.properties.center[1] }
      );

      if (pathPoints.length < 2) continue;

      this.agents.push({
        id: `sim_agent_${Date.now()}_${stableRandom()}`,
        cohortId: cohort.id,
        color: cohort.color,
        path: pathPoints,
        pathIndex: 0,
        lng: pathPoints[0].lng,
        lat: pathPoints[0].lat,
        progress: 0,
        speed: AGENT_SPEED_MS * (0.7 + stableRandom() * 0.6),
        walkPhase: stableRandom() * Math.PI * 2,
        state: 'MOVING',
        targetBuilding: endBuilding,
        currentBuilding: null,
        insideUntil: null,
        insideUntilSimTime: null,
        groupId: null,
        followsSchedule: false,
        lastScheduleHour: this.simTime
      });
    }

    this._updateLayer();
    console.log(`CrowdSimulator: Spawned ${agentsToSpawn} random agents`);
  }

  /**
   * Check if a road path should be avoided due to closures
   * Returns true if path contains a hard-closed road
   */
  _isPathBlocked(path) {
    // For now, check if any segment crosses a closed road
    // This is a simplified check - a more sophisticated version would 
    // integrate with NavigationGraph
    for (const [roadId, status] of this.roadClosures.entries()) {
      if (status === 'hard_closed') {
        // Simple heuristic: if roadId matches any path segment, consider blocked
        // In production, this would use actual road geometry
        return true; // This triggers route recalculation
      }
    }
    return false;
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

    // Start animation loop
    this.running = true;
    this._animate(performance.now());
  }

  setSimTime(t) {
    this.simTime = t;
  }

  /**
   * Compute real-time building occupancy from actual agent state.
   * Returns category-level and per-building counts based on agents in INSIDE state.
   */
  getBuildingOccupancy() {
    const categoryOccupancy = {};
    const buildingOccupancy = {};
    let totalInside = 0;
    let totalMoving = 0;

    for (const agent of this.agents) {
      if (agent.isStationary) continue; // Skip green area agents

      if (agent.state === 'INSIDE' && agent.currentBuilding) {
        totalInside++;
        const category = agent.currentBuilding.properties?.category || 'other';
        const buildingName = agent.currentBuilding.properties?.name || 
                             agent.currentBuilding.properties?.['addr:housename'] || 
                             `Building_${category}`;

        categoryOccupancy[category] = (categoryOccupancy[category] || 0) + 1;

        if (!buildingOccupancy[buildingName]) {
          buildingOccupancy[buildingName] = { count: 0, category };
        }
        buildingOccupancy[buildingName].count++;
      } else if (agent.state === 'MOVING') {
        totalMoving++;
      }
    }

    return {
      categoryOccupancy,
      buildingOccupancy,
      totalInside,
      totalMoving,
      totalAgents: totalInside + totalMoving
    };
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
    return validBuildings[Math.floor(stableRandom() * validBuildings.length)];
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
    return validBuildings[Math.floor(stableRandom() * validBuildings.length)];
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
    
    // Fall back to default schedule - find next category change
    const nextChangeHour = getNextScheduleChangeHour(cohortId, currentSimTime);
    console.log(`Agent ${cohortId} (default schedule) staying until ${nextChangeHour.toFixed(2)} (current: ${currentSimTime.toFixed(2)})`);
    return nextChangeHour;
  }

  // Check if schedule changed and agent needs to move
  _shouldAgentMove(agent, currentSimTime) {
    if (!agent.followsSchedule) return true; // Non-schedule followers always ready to move
    
    // Primary check: stay inside until scheduled end time
    if (agent.insideUntilSimTime !== undefined && agent.insideUntilSimTime !== null) {
      if (currentSimTime < agent.insideUntilSimTime) {
        return false; // Stay inside until scheduled end time
      }
    }
    
    // Schedule slot ended - check if destination category changed
    const currentCategory = getScheduledCategory(agent.cohortId, Math.floor(currentSimTime));
    const currentBuildingCategory = agent.currentBuilding?.properties?.category;
    
    // If already at the right category building, maybe stay longer
    if (currentBuildingCategory === currentCategory) {
      // Recalculate stay duration from current time
      const newEndTime = getNextScheduleChangeHour(agent.cohortId, currentSimTime);
      if (newEndTime > currentSimTime) {
        agent.insideUntilSimTime = newEndTime;
        return false; // Stay at this building
      }
    }
    
    return true; // Time to move to new destination
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
        const followsSchedule = stableRandom() < SCHEDULE_FOLLOW_RATIO;

        // Occasionally vary destination for realism (only non-schedule followers)
        if (!followsSchedule && stableRandom() > 0.7) {
          endBuilding = this._getBuildingForCategory(dstCategory);
        }

        const startLng = startBuilding.properties.center[0] + (stableRandom() - 0.5) * 0.00003;
        const startLat = startBuilding.properties.center[1] + (stableRandom() - 0.5) * 0.00003;
        const endLng = endBuilding.properties.center[0] + (stableRandom() - 0.5) * 0.00003;
        const endLat = endBuilding.properties.center[1] + (stableRandom() - 0.5) * 0.00003;

        const pathPoints = this.navGraph.findPath(
          { lng: startLng, lat: startLat },
          { lng: endLng, lat: endLat }
        );

        if (pathPoints.length < 2) continue;

        // Place agent at a random point along the path to create realistic distribution
        const pathIndex = Math.floor(stableRandom() * Math.max(1, pathPoints.length - 2));
        const startPos = pathPoints[pathIndex];
        const groupId = `group_${Date.now()}_${stableRandom()}`;

        // Create a small group of 2-4 people
        const groupSize = 2 + Math.floor(stableRandom() * 3);
        for (let g = 0; g < groupSize; g++) {
          // Schedule followers start INSIDE their scheduled building
          const isInside = followsSchedule && stableRandom() > 0.3; // 70% of schedule followers start inside
          
          this.agents.push({
            id: `agent_${Date.now()}_${stableRandom()}`,
            cohortId: cohort.id,
            color: cohort.color,
            path: pathPoints.slice(pathIndex),
            pathIndex: 0,
            lng: isInside ? startBuilding.properties.center[0] + (stableRandom() - 0.5) * 0.00002 : startPos.lng + (stableRandom() - 0.5) * 0.00002,
            lat: isInside ? startBuilding.properties.center[1] + (stableRandom() - 0.5) * 0.00002 : startPos.lat + (stableRandom() - 0.5) * 0.00002,
            progress: stableRandom() * 0.5,
            speed: AGENT_SPEED_MS * (0.7 + stableRandom() * 0.6),
            walkPhase: stableRandom() * Math.PI * 2,
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
          const lng = minLng + stableRandom() * (maxLng - minLng);
          const lat = minLat + stableRandom() * (maxLat - minLat);
          
          // Skip if outside focus area
          if (this.focusArea && this.focusArea.length >= 3 && !isPointInFocusArea([lng, lat], this.focusArea)) {
            continue;
          }

          // Create stationary agent (path with same start and end)
          this.agents.push({
            id: `green_agent_${Date.now()}_${stableRandom()}`,
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
            walkPhase: stableRandom() * Math.PI * 2,
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
          b2 = this.buildings[Math.floor(stableRandom() * this.buildings.length)];
          retries++;
        }
        if (b2 === b1) continue;

        const startLng = b1.properties.center[0] + (stableRandom() - 0.5) * 0.00003;
        const startLat = b1.properties.center[1] + (stableRandom() - 0.5) * 0.00003;
        const endLng   = b2.properties.center[0] + (stableRandom() - 0.5) * 0.00003;
        const endLat   = b2.properties.center[1] + (stableRandom() - 0.5) * 0.00003;

        // Get A* path — returns array of {lng, lat}
        const pathPoints = this.navGraph.findPath(
          { lng: startLng, lat: startLat },
          { lng: endLng, lat: endLat }
        );

        if (pathPoints.length < 2) continue;

        // Create group of 2-4 people
        const groupSize = 2 + Math.floor(stableRandom() * 3);
        const groupId = `group_${Date.now()}_${stableRandom()}`;
        const followsSchedule = stableRandom() < SCHEDULE_FOLLOW_RATIO;
        
        for (let g = 0; g < groupSize; g++) {
          this.agents.push({
            id: `agent_${Date.now()}_${stableRandom()}`,
            cohortId: cohort.id,
            color: cohort.color,
            path: pathPoints,
            pathIndex: 0,
            lng: pathPoints[0].lng + (stableRandom() - 0.5) * 0.00002,
            lat: pathPoints[0].lat + (stableRandom() - 0.5) * 0.00002,
            progress: 0,
            speed: AGENT_SPEED_MS * (0.7 + stableRandom() * 0.6), // variation in walking speed
            walkPhase: stableRandom() * Math.PI * 2,
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

    // In VISUALIZATION mode, agents are mostly static (camera-based positioning)
    // Only update positions when receiving camera events
    if (this.currentMode === 'visualize') {
      // In visualization mode, we just render static positions
      // Agents only move when we receive camera update events
      this._updateLayer();
      return;
    }
    
    // In ACTUATION mode, never show agents
    if (this.currentMode === 'actuate') {
      this._updateLayer();
      return;
    }
    
    // In SIMULATION mode with no active schedule, don't spawn agents
    if (this.currentMode === 'simulate' && !this.isSimulationActive) {
      this._updateLayer();
      return;
    }

    // Spawn new agents every ~1s (only in actuation mode or active simulation)
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
      const modeSpeedMultiplier = this.currentMode === 'simulate' ? 8 : 1;
      const step = agent.speed * dt * modeSpeedMultiplier;

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
            const stayUntil = this._getScheduleBasedStayDuration(agent.cohortId, this.simTime);
            // Ensure stay time is at least 30 minutes (0.5 hours) in the future
            agent.insideUntilSimTime = Math.max(stayUntil, this.simTime + 0.5);
            agent.insideUntil = null; // Not used for schedule followers
            console.log(`Agent entered INSIDE at building ${agent.currentBuilding?.properties?.name || 'unknown'}, staying until ${agent.insideUntilSimTime.toFixed(2)}`);
          } else {
            agent.insideUntil = performance.now() + (2000 + stableRandom() * 4000); // 2-6 seconds
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

    // Determine which agents to show based on mode
    let visibleAgents;
    
    if (this.currentMode === 'visualize') {
      // In visualization mode: show STATIONARY and MOVING agents (camera-based)
      // Hide INSIDE agents (they're inside buildings)
      visibleAgents = this.agents.filter(a => {
        if (a.state === 'INSIDE') return false;
        if (this.focusArea && this.focusArea.length >= 3) {
          return isPointInFocusArea([a.lng, a.lat], this.focusArea);
        }
        return true;
      });
    } else {
      // In actuation/simulation modes: show MOVING agents, hide INSIDE
      visibleAgents = this.agents.filter(a => {
        if (a.state === 'INSIDE') return false;
        if (this.focusArea && this.focusArea.length >= 3) {
          return isPointInFocusArea([a.lng, a.lat], this.focusArea);
        }
        return true;
      });
    }

    const features = visibleAgents.map(agent => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [agent.lng, agent.lat]
      },
      properties: {
        cohortId: agent.cohortId,
        // In visualization mode, use single color (can't detect cohort from cameras)
        color: this.currentMode === 'visualize' ? '#6366f1' : agent.color,
        icon: this.currentMode === 'simulate' ? '●' : this._getHumanEmoji(agent.cohortId)
      }
    }));

    this.map.getSource('crowd-agents').setData({
      type: 'FeatureCollection',
      features
    });
  }

_getHumanEmoji(cohortId) {
  const EMOJIS = ['🚶','🚶‍♂️','🚶‍♀️'];
  return EMOJIS[Math.floor(stableRandom() * EMOJIS.length)];
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
