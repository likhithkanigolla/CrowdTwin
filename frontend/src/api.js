const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const API_BASE_CANDIDATES = Array.from(new Set([
  API_BASE,
  ...(API_BASE === '/api' ? ['http://localhost:8000'] : []),
]));

const buildUrl = (base, path) => `${base}${path.startsWith('/') ? path : `/${path}`}`;

async function requestJson(path, options) {
  let lastError;

  for (let index = 0; index < API_BASE_CANDIDATES.length; index += 1) {
    const base = API_BASE_CANDIDATES[index];
    const isLast = index === API_BASE_CANDIDATES.length - 1;

    try {
      const response = await fetch(buildUrl(base, path), options);

      if (!response.ok) {
        if (!isLast && (response.status === 404 || response.status >= 500)) {
          continue;
        }
        throw new Error(`Request failed (${response.status})`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (!isLast) {
        continue;
      }
    }
  }

  throw lastError || new Error('Request failed');
}

export async function fetchCongestion(simTime) {
  return requestJson(`/congestion?sim_time=${simTime}`);
}

export async function suggestBuilding(payload) {
  return requestJson('/suggest-building', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function createEvent(payload) {
  return requestJson('/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function uploadMovementPlan(file) {
  const formData = new FormData();
  formData.append('file', file);

  let lastError;

  for (let index = 0; index < API_BASE_CANDIDATES.length; index += 1) {
    const base = API_BASE_CANDIDATES[index];
    const isLast = index === API_BASE_CANDIDATES.length - 1;

    try {
      const response = await fetch(buildUrl(base, '/movement-plan'), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        if (!isLast && (response.status === 404 || response.status >= 500)) {
          continue;
        }
        const errorData = await response.json();
        throw new Error(errorData.detail || `Upload failed (${response.status})`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (!isLast) {
        continue;
      }
    }
  }

  throw lastError || new Error('Upload failed');
}

export async function fetchSchedule() {
  return requestJson('/schedule');
}

// ==================== VISUALIZATION MODE APIs ====================

export async function postCameraFeed(cameras) {
  return requestJson('/camera-feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cameras,
      timestamp: new Date().toISOString()
    }),
  });
}

export async function getCameraFeed() {
  return requestJson('/camera-feed');
}

export async function updateBuildingOccupancy(buildingName, occupancy, capacity = null) {
  return requestJson('/building-occupancy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      building_name: buildingName,
      current_occupancy: occupancy,
      capacity: capacity,
      last_updated: new Date().toISOString()
    }),
  });
}

export async function getBuildingOccupancy() {
  return requestJson('/building-occupancy');
}

// ==================== ACTUATION MODE APIs ====================

export async function controlRoad(roadId, status, reason = null, roadName = null, closedBy = null) {
  return requestJson('/road-control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      road_id: roadId,
      road_name: roadName,
      status: status, // "open", "soft_closed", "hard_closed"
      reason: reason,
      closed_by: closedBy // "admin", "faculty", "student"
    }),
  });
}

export async function getRoadStatus() {
  return requestJson('/road-control');
}

export async function resetRoad(roadId) {
  return requestJson(`/road-control/${roadId}`, { method: 'DELETE' });
}

export async function registerRoads(roads) {
  return requestJson('/roads/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(roads),
  });
}

export async function getAvailableRoads() {
  return requestJson('/roads');
}

export async function addClassroomRequirement(requirement) {
  return requestJson('/classroom-requirement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requirement),
  });
}

export async function getClassroomRequirements() {
  return requestJson('/classroom-requirements');
}

export async function addActuationRule(rule) {
  return requestJson('/actuation-rule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
}

export async function getActuationRules() {
  return requestJson('/actuation-rules');
}

export async function deleteActuationRule(ruleId) {
  return requestJson(`/actuation-rule/${ruleId}`, { method: 'DELETE' });
}

export async function evaluateActuation(simTime = 8.0) {
  return requestJson(`/evaluate-actuation?sim_time=${simTime}`);
}

// ==================== SIMULATION MODE APIs ====================

export async function createSimulationConfig(config) {
  return requestJson('/simulation-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function getSimulationConfigs() {
  return requestJson('/simulation-configs');
}

export async function getSimulationConfig(name) {
  return requestJson(`/simulation-config/${name}`);
}

export async function deleteSimulationConfig(name) {
  return requestJson(`/simulation-config/${name}`, { method: 'DELETE' });
}

export async function evaluateSimulation(config) {
  return requestJson('/simulation-evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}
