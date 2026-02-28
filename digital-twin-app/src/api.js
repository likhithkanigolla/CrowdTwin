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
