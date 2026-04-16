import { useCallback, useEffect, useMemo, useState } from 'react';
import seedPayload from '../data/campusConfig.seed.json';

const STORAGE_KEY = 'crowdtwin.campus-config.v1';

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
