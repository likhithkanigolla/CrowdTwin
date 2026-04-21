import { useCallback, useEffect, useMemo, useState } from 'react';
import { registerRoads } from '../api';
import { fetchBuildings, fetchRoads } from '../utils/overpass';

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function useOverpassData(center, radiusMeters = 400, enabled = true) {
  const [roads, setRoads] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshSeq, setRefreshSeq] = useState(0);

  const safeCenter = useMemo(() => ({
    lat: toFiniteNumber(center?.lat, 17.4464),
    lng: toFiniteNumber(center?.lng, 78.3487),
  }), [center?.lat, center?.lng]);

  const safeRadius = useMemo(() => Math.max(100, toFiniteNumber(radiusMeters, 400)), [radiusMeters]);

  const refetch = useCallback(() => {
    setRefreshSeq((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setRoads([]);
      setBuildings([]);
      setError('');
      return;
    }

    const abortController = new AbortController();

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [roadsResult, buildingsResult] = await Promise.allSettled([
          fetchRoads(safeCenter, safeRadius, abortController.signal),
          fetchBuildings(safeCenter, safeRadius, abortController.signal),
        ]);

        if (abortController.signal.aborted) return;

        let nextRoads = null;
        let nextBuildings = null;
        const failures = [];

        if (roadsResult.status === 'fulfilled') {
          nextRoads = roadsResult.value || [];
          setRoads(nextRoads);
        } else {
          failures.push('roads');
        }

        if (buildingsResult.status === 'fulfilled') {
          nextBuildings = buildingsResult.value || [];
          setBuildings(nextBuildings);
        } else {
          failures.push('buildings');
        }

        if (failures.length === 0) {
          setError('');
        } else if (failures.length === 2) {
          setError('OSM unavailable right now. Using last known map data.');
        } else {
          setError(`Partial OSM data (${failures[0]} unavailable).`);
        }

        // Keep backend road registry in sync for control dropdowns.
        try {
          const payload = (nextRoads || []).map((road) => ({
            road_id: road.id,
            road_name: road.name,
            road_type: road.type || 'road',
          }));
          if (payload.length > 0) {
            await registerRoads(payload);
          }
        } catch {
          // Registry sync is best-effort.
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          setError(err?.message || 'Unable to load OSM geometry right now');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      abortController.abort();
    };
  }, [enabled, safeCenter, safeRadius, refreshSeq]);

  return { roads, buildings, loading, error, refetch };
}
