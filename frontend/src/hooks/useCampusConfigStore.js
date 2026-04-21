import { useCallback, useEffect, useMemo, useState } from 'react';
import seedPayload from '../data/campusConfig.seed.json';

const STORAGE_KEY = 'crowdtwin.campus-config.v1';
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const API_BASE_CANDIDATES = Array.from(new Set([
  API_BASE,
  ...(API_BASE === '/api' ? ['http://localhost:8904'] : []),
]));

function nowIso() {
  return new Date().toISOString();
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function migrateLegacyCampusIdentity(id, campusName) {
  let nextId = id;
  let nextCampusName = campusName;

  // Preserve existing user data while updating legacy default naming.
  if (/^cfg-cbit-main$/i.test(nextId)) {
    nextId = 'cfg-IIITH-main';
  }

  if (/cbit/i.test(nextCampusName)) {
    nextCampusName = nextCampusName.replace(/cbit/gi, 'IIITH');
  }

  return { id: nextId, campusName: nextCampusName };
}

function normalizeVirtualActuation(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    classroomTests: source.classroomTests && typeof source.classroomTests === 'object' ? source.classroomTests : {},
    professors: Array.isArray(source.professors) ? source.professors : [],
    gateSimulation: {
      profile: String(source?.gateSimulation?.profile || 'lecture_change'),
      lastRunAt: source?.gateSimulation?.lastRunAt || null,
    },
    routeProfile: String(source.routeProfile || 'normal'),
    controlPanel: {
      operatorName: String(source?.controlPanel?.operatorName || 'Campus Operator'),
      autoSyncDisplays: source?.controlPanel?.autoSyncDisplays !== false,
      updatedAt: source?.controlPanel?.updatedAt || null,
    },
  };
}

function normalizeConfig(config) {
  const centerLat = toFiniteNumber(config?.center?.lat, 17.4464);
  const centerLng = toFiniteNumber(config?.center?.lng, 78.3487);
  const radius = Math.max(25, toFiniteNumber(config?.radiusMeters, 250));
  const rawId = String(config?.id || `cfg-${Date.now()}`);
  const rawCampusName = String(config?.campusName || 'Campus');
  const { id, campusName } = migrateLegacyCampusIdentity(rawId, rawCampusName);

  return {
    id,
    campusName,
    center: {
      lat: centerLat,
      lng: centerLng,
    },
    radiusMeters: radius,
    buildings: Array.isArray(config?.buildings) ? config.buildings : [],
    gates: Array.isArray(config?.gates) ? config.gates : [],
    displays: Array.isArray(config?.displays) ? config.displays : [],
    timetables: Array.isArray(config?.timetables) ? config.timetables : [],
    rules: Array.isArray(config?.rules) ? config.rules : [],
    virtualActuation: normalizeVirtualActuation(config?.virtualActuation),
    createdAt: config?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizePayload(payload) {
  const configs = Array.isArray(payload?.configs) ? payload.configs : [];
  return {
    schemaVersion: Number(payload?.schemaVersion || 1),
    configs: configs.map(normalizeConfig),
  };
}

function parseFloorNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const m = raw.match(/-?\d+/);
  return m ? Number(m[0]) : 0;
}

function toDayLabel(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return 'Mon';
  const day = d.getDay();
  const map = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return map[day] || 'Mon';
}

function toHHMM(dateValue, fallback = '09:00') {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return fallback;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function mapRoomType(roomType) {
  const rt = String(roomType || '').toLowerCase();
  if (rt.includes('lab')) return 'lab';
  if (rt.includes('seminar')) return 'seminar';
  if (rt.includes('auditorium')) return 'auditorium';
  if (rt.includes('office')) return 'office';
  if (rt.includes('lecture') || rt.includes('class')) return 'classroom';
  return rt || 'classroom';
}

function parseBookingMeta(eventName) {
  const raw = String(eventName || '');
  const dayMatch = raw.match(/\[(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+S\d+\]/i);
  const roomMatch = raw.match(/[\u2013\-]\s*([^\[]+)\s*\[/);

  return {
    day: dayMatch ? dayMatch[1][0].toUpperCase() + dayMatch[1].slice(1).toLowerCase() : null,
    roomName: roomMatch ? roomMatch[1].trim() : null,
  };
}

async function fetchBackendCatalog() {
  let lastError;

  for (let i = 0; i < API_BASE_CANDIDATES.length; i += 1) {
    const base = API_BASE_CANDIDATES[i].replace(/\/$/, '');
    const isLast = i === API_BASE_CANDIDATES.length - 1;

    try {
      const response = await fetch(`${base}/allocations/catalog`);
      if (!response.ok) {
        if (!isLast && (response.status === 404 || response.status >= 500)) continue;
        throw new Error(`Catalog request failed (${response.status})`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      if (!isLast) continue;
    }
  }

  throw lastError || new Error('Catalog request failed');
}

function mapCatalogToConfig(catalog, baseConfig) {
  const sites = Array.isArray(catalog?.sites) ? catalog.sites : [];
  const buildings = Array.isArray(catalog?.buildings) ? catalog.buildings : [];
  const rooms = Array.isArray(catalog?.rooms) ? catalog.rooms : [];
  const bookings = Array.isArray(catalog?.bookings) ? catalog.bookings : [];

  const site = sites.length <= 1
    ? (sites[0] || null)
    : sites
        .map((candidate) => {
          const buildingCount = buildings.filter((b) => b.siteId === candidate.id).length;
          const bookingCount = bookings.filter((b) => b.siteId === candidate.id).length;
          return { candidate, score: (buildingCount * 1000) + bookingCount };
        })
        .sort((a, b) => b.score - a.score)[0]?.candidate || null;
  const siteBuildings = site ? buildings.filter((b) => b.siteId === site.id) : buildings;
  const buildingIds = new Set(siteBuildings.map((b) => b.id));
  const siteRooms = rooms.filter((r) => buildingIds.has(r.buildingId));
  const siteBookings = site ? bookings.filter((b) => b.siteId === site.id) : bookings;

  const roomsByBuilding = new Map();
  const roomsByName = new Map();
  for (const room of siteRooms) {
    const list = roomsByBuilding.get(room.buildingId) || [];
    list.push(room);
    roomsByBuilding.set(room.buildingId, list);
    if (room?.name) {
      roomsByName.set(String(room.name).trim().toLowerCase(), room.id);
    }
  }

  const mappedBuildings = siteBuildings.map((bld) => {
    const bldRooms = roomsByBuilding.get(bld.id) || [];
    const floorsMap = new Map();

    for (const room of bldRooms) {
      const floorNumber = parseFloorNumber(room.floor);
      const floorRooms = floorsMap.get(floorNumber) || [];
      floorRooms.push({
        id: room.id,
        name: room.name,
        capacity: Number(room.capacity) || 0,
        roomType: mapRoomType(room.roomType),
        equipment: { pc: true, projector: true },
      });
      floorsMap.set(floorNumber, floorRooms);
    }

    const floors = Array.from(floorsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([floorNumber, floorRooms]) => ({ floorNumber, rooms: floorRooms }));

    const lat = Number(bld?.location?.lat) || Number(bld?.position?.lat) || Number(baseConfig?.center?.lat) || 17.4464;
    const lng = Number(bld?.location?.lng) || Number(bld?.position?.lng) || Number(baseConfig?.center?.lng) || 78.3487;

    return {
      id: bld.id,
      name: bld.name,
      category: bld.category || 'classroom',
      lat,
      lng,
      position: {
        lat,
        lng,
      },
      floors,
    };
  });

  const timetables = siteBookings.map((booking) => {
    const meta = parseBookingMeta(booking.eventName);
    const normalizedRoomName = meta.roomName ? meta.roomName.toLowerCase() : '';
    const allocatedRoomId = roomsByName.get(normalizedRoomName) || null;
    const room = allocatedRoomId ? siteRooms.find((r) => r.id === allocatedRoomId) : null;
    const preferredRoomType = room ? mapRoomType(room.roomType) : 'classroom';

    return {
      id: booking.id,
      day: meta.day || toDayLabel(booking.startAt),
      startTime: toHHMM(booking.startAt, '09:00'),
      endTime: toHHMM(booking.endAt, '10:00'),
      courseCode: booking.eventName || 'EVENT',
      faculty: '',
      batch: '',
      expectedStrength: Number(booking.expectedAttendance) || 0,
      preferredRoomType,
      allocatedRoomId,
      status: booking.status === 'confirmed' ? 'allocated' : 'draft',
    };
  });

  const latValues = mappedBuildings.map((b) => Number(b?.position?.lat)).filter(Number.isFinite);
  const lngValues = mappedBuildings.map((b) => Number(b?.position?.lng)).filter(Number.isFinite);
  const center = latValues.length > 0
    ? {
        lat: latValues.reduce((s, v) => s + v, 0) / latValues.length,
        lng: lngValues.reduce((s, v) => s + v, 0) / lngValues.length,
      }
    : (baseConfig?.center || { lat: 17.4464, lng: 78.3487 });

  return {
    ...baseConfig,
    id: baseConfig?.id || 'cfg-IIITH-main',
    campusName: site?.name || baseConfig?.campusName || 'IIITH Campus',
    center,
    radiusMeters: baseConfig?.radiusMeters || 450,
    buildings: mappedBuildings,
    timetables,
  };
}

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

function seedData() {
  return normalizePayload(seedPayload || { schemaVersion: 1, configs: [] });
}

function download(name, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function useCampusConfigStore() {
  const [store, setStore] = useState(() => readFromStorage() || seedData());

  useEffect(() => {
    let cancelled = false;

    const hydrateFromBackend = async () => {
      try {
        const catalog = await fetchBackendCatalog();
        const hasBackendData =
          (Array.isArray(catalog?.buildings) && catalog.buildings.length > 0) ||
          (Array.isArray(catalog?.rooms) && catalog.rooms.length > 0) ||
          (Array.isArray(catalog?.bookings) && catalog.bookings.length > 0);

        if (!hasBackendData || cancelled) return;

        setStore((prev) => {
          const baseConfig = prev?.configs?.[0] || seedData().configs[0] || {};
          const merged = mapCatalogToConfig(catalog, baseConfig);
          return normalizePayload({
            schemaVersion: 1,
            configs: [merged],
          });
        });
      } catch {
        // Keep seed/local storage when backend is unavailable.
      }
    };

    hydrateFromBackend();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Ignore storage errors; user can still operate in-memory.
    }
  }, [store]);

  const setConfigs = useCallback((updater) => {
    setStore((prev) => {
      const nextConfigs = typeof updater === 'function' ? updater(prev.configs) : updater;
      return {
        ...prev,
        configs: Array.isArray(nextConfigs) ? nextConfigs.map(normalizeConfig) : [],
      };
    });
  }, []);

  const patchConfig = useCallback((configId, patch) => {
    setConfigs((configs) =>
      configs.map((cfg) =>
        cfg.id === configId
          ? normalizeConfig({ ...cfg, ...patch, updatedAt: nowIso() })
          : cfg
      )
    );
  }, [setConfigs]);

  const upsertConfig = useCallback((config) => {
    setConfigs((configs) => {
      const normalized = normalizeConfig(config);
      const idx = configs.findIndex((cfg) => cfg.id === normalized.id);
      if (idx === -1) {
        return [...configs, normalized];
      }

      const next = [...configs];
      next[idx] = normalizeConfig({ ...next[idx], ...normalized, updatedAt: nowIso() });
      return next;
    });
  }, [setConfigs]);

  const addBuilding = useCallback((configId, building) => {
    patchConfig(configId, {
      buildings: (store.configs.find((cfg) => cfg.id === configId)?.buildings || []).concat([
        { ...building, id: building.id || `bld-${Date.now()}` },
      ]),
    });
  }, [patchConfig, store.configs]);

  const removeBuilding = useCallback((configId, buildingId) => {
    const current = store.configs.find((cfg) => cfg.id === configId);
    if (!current) return;
    patchConfig(configId, {
      buildings: current.buildings.filter((bld) => bld.id !== buildingId),
    });
  }, [patchConfig, store.configs]);

  const updateBuilding = useCallback((configId, buildingId, patch) => {
    const current = store.configs.find((cfg) => cfg.id === configId);
    if (!current) return;
    patchConfig(configId, {
      buildings: current.buildings.map((bld) => (bld.id === buildingId ? { ...bld, ...patch } : bld)),
    });
  }, [patchConfig, store.configs]);

  const updateGate = useCallback((configId, gateId, gate) => {
    const current = store.configs.find((cfg) => cfg.id === configId);
    if (!current) return;
    patchConfig(configId, {
      gates: current.gates.map((item) => (item.id === gateId ? { ...item, ...gate } : item)),
    });
  }, [patchConfig, store.configs]);

  const updateDisplay = useCallback((configId, displayId, display) => {
    const current = store.configs.find((cfg) => cfg.id === configId);
    if (!current) return;
    patchConfig(configId, {
      displays: current.displays.map((item) => (item.id === displayId ? { ...item, ...display } : item)),
    });
  }, [patchConfig, store.configs]);

  const setRules = useCallback((configId, rules) => {
    patchConfig(configId, { rules: Array.isArray(rules) ? rules : [] });
  }, [patchConfig]);

  const setTimetables = useCallback((configId, timetables) => {
    patchConfig(configId, { timetables: Array.isArray(timetables) ? timetables : [] });
  }, [patchConfig]);

  const exportJson = useCallback(() => {
    const filename = `campus-config-${Date.now()}.json`;
    download(filename, JSON.stringify(store, null, 2), 'application/json');
  }, [store]);

  const importJson = useCallback(async (file) => {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const normalized = normalizePayload(parsed);
    setStore(normalized);
  }, []);

  const resetToSeed = useCallback(() => {
    setStore(seedData());
  }, []);

  return useMemo(() => ({
    schemaVersion: store.schemaVersion,
    configs: store.configs,
    setConfigs,
    patchConfig,
    upsertConfig,
    addBuilding,
    removeBuilding,
    updateBuilding,
    updateGate,
    updateDisplay,
    setRules,
    setTimetables,
    exportJson,
    importJson,
    resetToSeed,
  }), [
    store,
    setConfigs,
    patchConfig,
    upsertConfig,
    addBuilding,
    removeBuilding,
    updateBuilding,
    updateGate,
    updateDisplay,
    setRules,
    setTimetables,
    exportJson,
    importJson,
    resetToSeed,
  ]);
}
