import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import osmtogeojson from 'osmtogeojson';
import { CrowdSimulator, COHORTS } from '../engine/CrowdSimulator';
import { ModelLayer } from '../engine/ModelLayer';
import { SimulationDB } from '../engine/SimulationDB';
import { buildPedSimSceneGeoJSON } from '../data/pedsimScene';
import { getAvailableRoads, registerRoads, getBuildingOccupancy, getSyntheticDashboard, getSyntheticCameras, exportPedSimSceneFromMap } from '../api';

// Subtle semantic colors — not too vivid, realistic-looking at night
const SEMANTIC_COLORS = {
    hostels: '#93c5fd', // Light blue
    academics: '#fbbf24', // Amber 
    canteens: '#34d399', // Emerald
    recreation: '#6ee7b7', // Mint
    admin: '#c4b5fd', // Lavender
    gates: '#fca5a5', // Light red
    other: '#94a3b8'  // Cool grey
};

// How transparent buildings look — they get subtle glow from their semantic hue
const BUILDING_PAINT = {
    'fill-extrusion-color': ['get', 'color'],
    'fill-extrusion-height': ['get', 'height'],
    'fill-extrusion-base': ['get', 'base_height'],
    'fill-extrusion-opacity': 0.75,
    'fill-extrusion-vertical-gradient': true,
};

// Camera emoji for visualization mode
const CAMERA_EMOJI = '📹';

const isPointInRing = (point, ring) => {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersects = ((yi > y) !== (yj > y))
            && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
};

const sampleTreePositionsFromRing = (ring, targetCount) => {
    if (!ring || ring.length < 3 || targetCount <= 0) return [];

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    ring.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    });

    if (!Number.isFinite(minLng) || !Number.isFinite(maxLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
        return [];
    }

    const points = [];
    const maxAttempts = targetCount * 16;
    let attempts = 0;

    while (points.length < targetCount && attempts < maxAttempts) {
        attempts += 1;
        const lng = minLng + stableRandom() * (maxLng - minLng);
        const lat = minLat + stableRandom() * (maxLat - minLat);
        if (isPointInRing([lng, lat], ring)) {
            points.push({ lng, lat });
        }
    }

    return points;
};

const TREE_EMOJIS = ['🌳', '🌲', '🌴'];

const PEDSIM_SCENE = buildPedSimSceneGeoJSON();


const getPerimeterCameraPoint = (feature) => {
    const geometry = feature?.geometry;
    if (!geometry) return null;

    const rings = geometry.type === 'Polygon'
        ? [geometry.coordinates[0]]
        : geometry.type === 'MultiPolygon'
            ? geometry.coordinates.map(poly => poly[0])
            : [];

    let bestPoint = null;
    let bestDistance = Infinity;

    rings.forEach((ring) => {
        if (!ring || ring.length < 4) return;

        let centroidLng = 0;
        let centroidLat = 0;
        let count = 0;
        ring.forEach(([lng, lat]) => {
            centroidLng += lng;
            centroidLat += lat;
            count += 1;
        });

        if (!count) return;

        centroidLng /= count;
        centroidLat /= count;

        for (let i = 0; i < ring.length - 1; i++) {
            const [lng1, lat1] = ring[i];
            const [lng2, lat2] = ring[i + 1];
            const midpointLng = (lng1 + lng2) / 2;
            const midpointLat = (lat1 + lat2) / 2;
            const distance = Math.hypot(midpointLng - centroidLng, midpointLat - centroidLat);

            if (distance < bestDistance) {
                bestDistance = distance;
                const inwardScale = 0.92;
                bestPoint = {
                    lng: centroidLng + (midpointLng - centroidLng) * inwardScale,
                    lat: centroidLat + (midpointLat - centroidLat) * inwardScale,
                };
            }
        }
    });

    return bestPoint;
};
const stableRandom = (() => {
    let seed = 123456789;
    return () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
    };
})();

// Generate a campus-wide set of camera positions across buildings and roads
const generateCameraPositions = (buildings, pathways, targetCount = 220) => {
    const positions = [];
    const seen = new Set();
    let cameraId = 0;
    const startTime = performance.now();

    const addCamera = (camera) => {
        if (!camera || !Number.isFinite(camera.lng) || !Number.isFinite(camera.lat)) return;
        const key = `${camera.type || 'camera'}:${camera.lng.toFixed(6)}:${camera.lat.toFixed(6)}`;
        if (seen.has(key)) return;
        seen.add(key);
        positions.push({
            id: camera.id || `cam_${cameraId++}`,
            lng: camera.lng,
            lat: camera.lat,
            type: camera.type || 'building_entrance',
            name: camera.name || `Camera ${cameraId}`,
            direction: camera.direction || 'bidirectional',
            zone: camera.zone || 'other',
        });
    };

    const categoryOrder = ['gates', 'admin', 'academics', 'canteens', 'hostels', 'recreation', 'other'];
    const buildingFeatures = Array.isArray(buildings?.features) ? [...buildings.features] : [];

    buildingFeatures
        .sort((a, b) => {
            const categoryDiff = categoryOrder.indexOf(a.properties?.category || 'other') - categoryOrder.indexOf(b.properties?.category || 'other');
            if (categoryDiff !== 0) return categoryDiff;
            return String(a.properties?.name || '').localeCompare(String(b.properties?.name || ''));
        })
        .forEach((feature) => {
            const perimeterPoint = getPerimeterCameraPoint(feature);
            const fallbackCenter = feature.properties?.center;
            const center = perimeterPoint || (
                Array.isArray(fallbackCenter)
                    ? { lng: fallbackCenter[0], lat: fallbackCenter[1] }
                    : fallbackCenter
            );
            const name = feature.properties?.name || feature.properties?.['addr:housename'] || 'Building';
            const category = feature.properties?.category || 'other';

            addCamera({
                lng: center?.lng,
                lat: center?.lat,
                type: 'building_entrance',
                name: `${name} Entrance`,
                direction: 'bidirectional',
                zone: category,
            });
        });

    const pathwayFeatures = Array.isArray(pathways?.features) ? pathways.features : [];
    pathwayFeatures.forEach((feature, featureIndex) => {
        const geometry = feature?.geometry;
        const roadName = feature.properties?.road_name || feature.properties?.name || feature.properties?.highway || `Path ${featureIndex + 1}`;
        const lines = geometry?.type === 'LineString'
            ? [geometry.coordinates]
            : geometry?.type === 'MultiLineString'
                ? geometry.coordinates
                : [];

        lines.forEach((line, lineIndex) => {
            const coords = (Array.isArray(line) ? line : [])
                .filter((point) => Array.isArray(point) && point.length >= 2)
                .map((point) => [Number(point[0]), Number(point[1])])
                .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

            if (coords.length < 2) return;

            const step = Math.max(1, Math.ceil(coords.length / 6));
            for (let index = 0; index < coords.length - 1 && positions.length < targetCount; index += step) {
                const startPoint = coords[index];
                const endPoint = coords[Math.min(index + 1, coords.length - 1)];
                addCamera({
                    lng: (startPoint[0] + endPoint[0]) / 2,
                    lat: (startPoint[1] + endPoint[1]) / 2,
                    type: 'road_watch',
                    name: `${roadName} ${lineIndex + 1}`,
                    direction: 'bidirectional',
                    zone: feature.properties?.category || 'other',
                });
            }
        });
    });

    console.log(`🎥 Generated ${positions.length} campus cameras in ${(performance.now() - startTime).toFixed(2)}ms`);
    return positions.slice(0, targetCount);
};

const buildCameraFeatures = (positions) => ({
    type: 'FeatureCollection',
    features: positions.map((p) => ({
        type: 'Feature',
        properties: {
            id: p.id,
            type: p.type,
            name: p.name,
            direction: p.direction
        },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
    }))
});

// Generate camera pole lines for visualization
const buildCameraPoleLines = (positions) => ({
    type: 'FeatureCollection',
    features: positions.map((p) => ({
        type: 'Feature',
        properties: {
            id: p.id,
            camera_id: p.id
        },
        geometry: {
            type: 'LineString',
            coordinates: [
                [p.lng, p.lat - 0.00005],
                [p.lng, p.lat + 0.00025]
            ]
        }
    }))
});

const SYNTHETIC_AGENT_PREFIX = 'synthetic-live';

const CAMERA_ZONE_TO_BUILDING_CATEGORIES = {
    hostel: ['hostels'],
    girls_hostel: ['hostels'],
    classroom: ['academics'],
    research: ['admin', 'academics'],
    lab: ['academics'],
    canteen: ['canteens'],
    residential: ['admin'],
    venue: ['recreation'],
    gate: ['gates'],
    road: ['gates', 'other'],
    other: ['other'],
};

const normalizeCameraId = (camera) => camera?.camera_id || camera?.location_name || 'camera';

const isSyntheticAgent = (agent) => String(agent?.id || '').startsWith(SYNTHETIC_AGENT_PREFIX);

const createSeededRandom = (seedText) => {
    let seed = 0;
    const text = String(seedText || 'crowdtwin');

    for (let index = 0; index < text.length; index += 1) {
        seed = ((seed * 31) + text.charCodeAt(index)) >>> 0;
    }

    return () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
    };
};

const moveTowardPoint = (current, target, maxStep) => {
    const dlng = target.lng - current.lng;
    const dlat = target.lat - current.lat;
    const distance = Math.hypot(dlng, dlat);

    if (!Number.isFinite(distance) || distance <= maxStep) {
        return { lng: target.lng, lat: target.lat, arrived: true };
    }

    const ratio = maxStep / distance;
    return {
        lng: current.lng + dlng * ratio,
        lat: current.lat + dlat * ratio,
        arrived: false,
    };
};

const samplePointInRing = (ring, rng = Math.random) => {
    if (!Array.isArray(ring) || ring.length < 4) return null;

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    ring.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    });

    if (!Number.isFinite(minLng) || !Number.isFinite(maxLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
        return null;
    }

    for (let attempt = 0; attempt < 24; attempt += 1) {
        const lng = minLng + rng() * (maxLng - minLng);
        const lat = minLat + rng() * (maxLat - minLat);
        if (isPointInRing([lng, lat], ring)) {
            return { lng, lat };
        }
    }

    const centroid = ring.reduce((accumulator, point) => {
        accumulator.lng += point[0];
        accumulator.lat += point[1];
        accumulator.count += 1;
        return accumulator;
    }, { lng: 0, lat: 0, count: 0 });

    return centroid.count > 0
        ? { lng: centroid.lng / centroid.count, lat: centroid.lat / centroid.count }
        : null;
};

const samplePointInFeature = (feature, rng = Math.random) => {
    const geometry = feature?.geometry;
    if (!geometry) return null;

    if (geometry.type === 'Polygon') {
        return samplePointInRing(geometry.coordinates?.[0], rng);
    }

    if (geometry.type === 'MultiPolygon') {
        const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
        if (!polygons.length) return null;
        const ring = polygons[Math.floor(rng() * polygons.length)]?.[0];
        return samplePointInRing(ring, rng);
    }

    const center = feature?.properties?.center;
    if (Array.isArray(center) && center.length >= 2) {
        return { lng: center[0], lat: center[1] };
    }

    return null;
};

const sampleAnchorPoint = (camera, building, rng = Math.random) => {
    const buildingPoint = samplePointInFeature(building, rng);
    if (buildingPoint) return buildingPoint;

    const cameraLng = Number(camera?.lng);
    const cameraLat = Number(camera?.lat);
    if (Number.isFinite(cameraLng) && Number.isFinite(cameraLat)) {
        return {
            lng: cameraLng + (rng() - 0.5) * 0.00004,
            lat: cameraLat + (rng() - 0.5) * 0.00004,
        };
    }

    return null;
};

const getCameraBuildingCandidates = (camera, buildings) => {
    const features = Array.isArray(buildings?.features) ? buildings.features : [];
    if (!camera || !features.length) return [];

    const cameraName = String(camera.location_name || '').toLowerCase();
    const exactMatches = features.filter((feature) => {
        const buildingName = String(feature.properties?.name || '').toLowerCase();
        const buildingNameAlt = String(feature.properties?.['addr:housename'] || '').toLowerCase();
        return Boolean(
            buildingName && cameraName && (buildingName.includes(cameraName) || cameraName.includes(buildingName))
            || buildingNameAlt && cameraName && (buildingNameAlt.includes(cameraName) || cameraName.includes(buildingNameAlt))
        );
    });

    if (exactMatches.length > 0) {
        return exactMatches;
    }

    const categoryMatches = (CAMERA_ZONE_TO_BUILDING_CATEGORIES[camera.zone] || ['other'])
        .flatMap((category) => features.filter((feature) => feature.properties?.category === category));

    if (categoryMatches.length > 0) {
        return categoryMatches;
    }

    return features;
};

const buildSyntheticAgentState = (camera, building, index) => {
    const rng = createSeededRandom(`${normalizeCameraId(camera)}:${index}`);
    const anchor = sampleAnchorPoint(camera, building, rng);
    if (!anchor) return null;

    const randomOffset = () => (rng() - 0.5) * 0.00003;
    const start = {
        lng: anchor.lng + randomOffset(),
        lat: anchor.lat + randomOffset(),
    };

    return {
        id: `${SYNTHETIC_AGENT_PREFIX}-${normalizeCameraId(camera)}-${index}`,
        cameraSource: normalizeCameraId(camera),
        currentBuilding: building || null,
        zone: camera.zone || 'other',
        lng: start.lng,
        lat: start.lat,
        targetLng: anchor.lng,
        targetLat: anchor.lat,
        lastRetargetAt: performance.now(),
        rngSeed: `${normalizeCameraId(camera)}:${index}`,
    };
};

const advanceSyntheticAgentState = (state, camera, building) => {
    const rng = createSeededRandom(`${state.rngSeed}:${Math.floor(performance.now() / 250)}`);
    const currentPoint = { lng: state.lng, lat: state.lat };
    const targetPoint = { lng: state.targetLng, lat: state.targetLat };
    const step = 0.000004 + (rng() * 0.000003);
    const moved = moveTowardPoint(currentPoint, targetPoint, step);

    state.lng = moved.lng;
    state.lat = moved.lat;
    state.currentBuilding = building || state.currentBuilding || null;

    const elapsed = performance.now() - state.lastRetargetAt;
    if (moved.arrived || elapsed > 1800 + (rng() * 2200)) {
        const nextAnchor = sampleAnchorPoint(camera, building, rng);
        if (nextAnchor) {
            state.targetLng = nextAnchor.lng + (rng() - 0.5) * 0.00002;
            state.targetLat = nextAnchor.lat + (rng() - 0.5) * 0.00002;
            state.lastRetargetAt = performance.now();
        }
    }

    return state;
};

// Generate streetlight positions along pathways at regular intervals
const generateStreetlightPositions = (pathways, intervalMeters = 30) => {
    const positions = [];
    const metersPerDegLat = 111320;

    pathways.features.forEach(feature => {
        if (feature.geometry.type !== 'LineString') return;
        const coords = feature.geometry.coordinates;

        // Calculate total length and place lights at intervals
        for (let i = 0; i < coords.length - 1; i++) {
            const [lng1, lat1] = coords[i];
            const [lng2, lat2] = coords[i + 1];

            const metersPerDegLng = metersPerDegLat * Math.cos(lat1 * Math.PI / 180);
            const dx = (lng2 - lng1) * metersPerDegLng;
            const dy = (lat2 - lat1) * metersPerDegLat;
            const segLen = Math.sqrt(dx * dx + dy * dy);

            const numLights = Math.floor(segLen / intervalMeters);
            for (let j = 0; j <= numLights; j++) {
                const t = numLights > 0 ? j / numLights : 0;
                positions.push({
                    lng: lng1 + t * (lng2 - lng1),
                    lat: lat1 + t * (lat2 - lat1)
                });
            }
        }
    });

    return positions;
};

const buildStreetlightFeatures = (positions) => ({
    type: 'FeatureCollection',
    features: positions.map((p, idx) => ({
        type: 'Feature',
        properties: { id: idx },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
    }))
});

const buildTreePointFeatures = (treePositions) => {
    return {
        type: 'FeatureCollection',
        features: treePositions.map((t, idx) => ({
            type: 'Feature',
            properties: {
                id: idx,
                icon: TREE_EMOJIS[Math.floor(stableRandom() * TREE_EMOJIS.length)]
            },
            geometry: {
                type: 'Point',
                coordinates: [t.lng, t.lat]
            }
        }))
    };
};

const createRectangleFeature = (centerLng, centerLat, halfLng, halfLat, properties) => ({
    type: 'Feature',
    properties,
    geometry: {
        type: 'Polygon',
        coordinates: [[
            [centerLng - halfLng, centerLat - halfLat],
            [centerLng + halfLng, centerLat - halfLat],
            [centerLng + halfLng, centerLat + halfLat],
            [centerLng - halfLng, centerLat + halfLat],
            [centerLng - halfLng, centerLat - halfLat],
        ]]
    }
});

const buildFallbackGeojson = (centerLng, centerLat) => {
    const features = [
        createRectangleFeature(centerLng - 0.00055, centerLat + 0.00042, 0.00018, 0.00012, {
            building: 'yes',
            name: 'Academic Block A',
            'building:levels': '4'
        }),
        createRectangleFeature(centerLng + 0.00045, centerLat + 0.00025, 0.00016, 0.00011, {
            building: 'yes',
            name: 'Hostel Block 1',
            'building:levels': '5'
        }),
        createRectangleFeature(centerLng + 0.0002, centerLat - 0.00038, 0.00014, 0.0001, {
            building: 'yes',
            name: 'Canteen',
            'building:levels': '2'
        }),
        createRectangleFeature(centerLng - 0.00025, centerLat + 0.0001, 0.0004, 0.00022, {
            landuse: 'grass'
        }),
        createRectangleFeature(centerLng + 0.00052, centerLat - 0.00022, 0.00035, 0.0002, {
            leisure: 'park'
        }),
        {
            type: 'Feature',
            properties: { highway: 'secondary' },
            geometry: {
                type: 'LineString',
                coordinates: [
                    [centerLng - 0.001, centerLat - 0.0008],
                    [centerLng - 0.0004, centerLat - 0.0002],
                    [centerLng + 0.0004, centerLat + 0.00015],
                    [centerLng + 0.001, centerLat + 0.0008],
                ]
            }
        },
        {
            type: 'Feature',
            properties: { highway: 'tertiary' },
            geometry: {
                type: 'LineString',
                coordinates: [
                    [centerLng - 0.0009, centerLat + 0.00075],
                    [centerLng - 0.0002, centerLat + 0.00035],
                    [centerLng + 0.00045, centerLat - 0.00005],
                    [centerLng + 0.00095, centerLat - 0.00045],
                ]
            }
        }
    ];

    return { type: 'FeatureCollection', features };
};

const addOrUpdateSource = (map, sourceId, data) => {
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(data);
        return;
    }
    map.addSource(sourceId, { type: 'geojson', data });
};

const ensurePedSimSceneOverlay = (map) => {
    if (!map || !map.isStyleLoaded()) return;

    addOrUpdateSource(map, 'pedsim-boundary', PEDSIM_SCENE.boundary);
    addOrUpdateSource(map, 'pedsim-obstacles', PEDSIM_SCENE.obstacles);
    addOrUpdateSource(map, 'pedsim-walls', PEDSIM_SCENE.walls);
    addOrUpdateSource(map, 'pedsim-roads', PEDSIM_SCENE.roads);
    addOrUpdateSource(map, 'pedsim-waypoints', PEDSIM_SCENE.waypoints);

    if (!map.getLayer('pedsim-boundary-fill')) {
        map.addLayer({
            id: 'pedsim-boundary-fill',
            type: 'fill',
            source: 'pedsim-boundary',
            paint: {
                'fill-color': '#0f172a',
                'fill-opacity': 0.06
            }
        });
    }

    if (!map.getLayer('pedsim-boundary-outline')) {
        map.addLayer({
            id: 'pedsim-boundary-outline',
            type: 'line',
            source: 'pedsim-boundary',
            paint: {
                'line-color': '#f59e0b',
                'line-width': 4,
                'line-opacity': 0.95
            }
        });
    }

    if (!map.getLayer('pedsim-obstacles-fill')) {
        map.addLayer({
            id: 'pedsim-obstacles-fill',
            type: 'fill',
            source: 'pedsim-obstacles',
            paint: {
                'fill-color': '#fb923c',
                'fill-opacity': 0.2
            }
        });
    }

    if (!map.getLayer('pedsim-obstacles-outline')) {
        map.addLayer({
            id: 'pedsim-obstacles-outline',
            type: 'line',
            source: 'pedsim-obstacles',
            paint: {
                'line-color': '#d97706',
                'line-width': 2.5,
                'line-opacity': 0.95
            }
        });
    }

    if (!map.getLayer('pedsim-roads-layer')) {
        map.addLayer({
            id: 'pedsim-roads-layer',
            type: 'line',
            source: 'pedsim-roads',
            paint: {
                'line-color': '#38bdf8',
                'line-width': 3,
                'line-opacity': 0.7,
                'line-dasharray': [2, 1]
            }
        });
    }

    if (!map.getLayer('pedsim-waypoints-layer')) {
        map.addLayer({
            id: 'pedsim-waypoints-layer',
            type: 'circle',
            source: 'pedsim-waypoints',
            paint: {
                'circle-radius': 4,
                'circle-color': '#fde68a',
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#7c2d12'
            }
        });
    }
};

const toBoundaryRing = (selectedArea) => {
    if (!selectedArea) return null;

    if (selectedArea.type === 'Feature' && selectedArea.geometry?.type === 'Polygon') {
        return selectedArea.geometry.coordinates?.[0] || null;
    }

    if (selectedArea.type === 'FeatureCollection' && Array.isArray(selectedArea.features)) {
        const polygon = selectedArea.features.find(
            (feature) => feature?.geometry?.type === 'Polygon' && Array.isArray(feature.geometry.coordinates?.[0])
        );
        return polygon?.geometry?.coordinates?.[0] || null;
    }

    if (Array.isArray(selectedArea.points) && selectedArea.points.length >= 3) {
        const ring = selectedArea.points.map((point) => [point.lng, point.lat]);
        ring.push([selectedArea.points[0].lng, selectedArea.points[0].lat]);
        return ring;
    }

    return null;
};

const toBoundaryFeatureCollection = (selectedArea) => {
    if (!selectedArea) return null;

    if (selectedArea.type === 'FeatureCollection' && Array.isArray(selectedArea.features)) {
        return selectedArea;
    }

    const ring = toBoundaryRing(selectedArea);
    if (ring) {
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { source: 'selected_area' },
                geometry: {
                    type: 'Polygon',
                    coordinates: [ring],
                },
            }],
        };
    }

    return null;
};

const dedupeCoords = (coords) => {
    const seen = new Set();
    const unique = [];

    coords.forEach((point) => {
        if (!Array.isArray(point) || point.length < 2) return;
        const lng = Number(point[0]);
        const lat = Number(point[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

        const key = `${lng.toFixed(7)}|${lat.toFixed(7)}`;
        if (seen.has(key)) return;
        seen.add(key);
        unique.push([lng, lat]);
    });

    return unique;
};

const convexHull = (points) => {
    if (!Array.isArray(points) || points.length < 3) return null;

    const sorted = [...points].sort((left, right) => {
        if (left[0] !== right[0]) return left[0] - right[0];
        return left[1] - right[1];
    });

    const cross = (origin, a, b) => {
        return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
    };

    const lower = [];
    sorted.forEach((point) => {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
            lower.pop();
        }
        lower.push(point);
    });

    const upper = [];
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
        const point = sorted[index];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
            upper.pop();
        }
        upper.push(point);
    }

    lower.pop();
    upper.pop();
    const hull = [...lower, ...upper];

    return hull.length >= 3 ? hull : null;
};

const buildBoundaryFromFeatureCollections = (...collections) => {
    const coords = [];

    collections.forEach((collection) => {
        const features = collection?.features || [];
        features.forEach((feature) => {
            const geometry = feature?.geometry;
            if (!geometry) return;

            if (geometry.type === 'Polygon') {
                (geometry.coordinates?.[0] || []).forEach((point) => coords.push(point));
            } else if (geometry.type === 'MultiPolygon') {
                (geometry.coordinates || []).forEach((polygon) => {
                    (polygon?.[0] || []).forEach((point) => coords.push(point));
                });
            } else if (geometry.type === 'LineString') {
                (geometry.coordinates || []).forEach((point) => coords.push(point));
            } else if (geometry.type === 'MultiLineString') {
                (geometry.coordinates || []).forEach((line) => {
                    (line || []).forEach((point) => coords.push(point));
                });
            }
        });
    });

    const uniqueCoords = dedupeCoords(coords);
    if (uniqueCoords.length < 3) return null;

    const hull = convexHull(uniqueCoords);
    if (hull && hull.length >= 3) {
        const ring = [...hull, hull[0]];
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { source: 'map_hull' },
                geometry: {
                    type: 'Polygon',
                    coordinates: [ring],
                },
            }],
        };
    }

    const lngs = uniqueCoords.map((point) => point[0]);
    const lats = uniqueCoords.map((point) => point[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const padLng = Math.max(0.0002, (maxLng - minLng) * 0.04);
    const padLat = Math.max(0.0002, (maxLat - minLat) * 0.04);

    const ring = [
        [minLng - padLng, minLat - padLat],
        [maxLng + padLng, minLat - padLat],
        [maxLng + padLng, maxLat + padLat],
        [minLng - padLng, maxLat + padLat],
        [minLng - padLng, minLat - padLat],
    ];

    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { source: 'map_bbox' },
            geometry: {
                type: 'Polygon',
                coordinates: [ring],
            },
        }],
    };
};

const removeCrowdLayers = (map) => {
    ['crowd-agents-layer', 'crowd-agents-dot', 'crowd-agents-glow'].forEach((id) => {
        if (map.getLayer(id)) {
            map.removeLayer(id);
        }
    });

    if (map.getSource('crowd-agents')) {
        map.removeSource('crowd-agents');
    }
};

export default function MapContainer({
    currentMode,
    onBuildingSelect,
    onBuildingsLoaded,
    onSimulatorReady,
    onMapBoundaryChange,
    onPedSimSceneExport,
    simTime,
    isPlacingPoints,
    setIsPlacingPoints,
    areaPoints,
    setAreaPoints,
    selectedArea,
    setSelectedArea,
    mapLat,
    mapLng,
    onMapLoadingChange,
    teleportRequestId
}) {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const simRef = useRef(null);       // CrowdSimulator instance 
    const modelLayerRef = useRef(null); // GLTF ModelLayer instance
    const allBuildingsRef = useRef(null); // Store all buildings (unfiltered)
    const allGreenAreasRef = useRef(null); // Store all green areas (unfiltered)
    const allPathwaysRef = useRef(null); // Store all pathways (unfiltered)
    const mapOriginRef = useRef({ lng: 78.3487, lat: 17.4464 });
    const crowdVisibilityStateRef = useRef('');
    const roadStatusByIdRef = useRef({});
    const syntheticCamerasRef = useRef([]);
    const syntheticAgentStateRef = useRef(new Map());
    const syntheticAgentSeqRef = useRef(0);
    const cameraFeedSignatureRef = useRef('');
    const sceneExportStateRef = useRef({ signature: '', inFlight: false });
    const [loading, setLoading] = useState(false);

    // Helper function to check if a point is inside a polygon (ray casting algorithm)
    const isPointInPolygon = (point, polygon) => {
        const ring = toBoundaryRing(polygon);
        if (!ring || ring.length < 4) return true; // No polygon = include all
        const x = point.lng || point[0];
        const y = point.lat || point[1];

        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];

            if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    };

    // Filter buildings by focus area
    const filterFeaturesByArea = (features, area) => {
        const ring = toBoundaryRing(area);
        if (!ring || ring.length < 4) return features;

        return features.filter(feature => {
            const center = feature.properties?.center;
            if (!center) return false;
            return isPointInPolygon({ lng: center[0], lat: center[1] }, area);
        });
    };

    // Update markers layer for placed points
    const updatePointMarkersLayer = (map, points) => {
        const geojson = {
            type: 'FeatureCollection',
            features: points.map((p, idx) => ({
                type: 'Feature',
                properties: { id: idx, label: `${idx + 1}` },
                geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
            }))
        };

        if (map.getSource('area-markers')) {
            map.getSource('area-markers').setData(geojson);
        } else {
            map.addSource('area-markers', { type: 'geojson', data: geojson });
            map.addLayer({
                id: 'area-markers-circle',
                type: 'circle',
                source: 'area-markers',
                paint: {
                    'circle-radius': 10,
                    'circle-color': '#ef4444',
                    'circle-stroke-width': 3,
                    'circle-stroke-color': '#ffffff'
                }
            });
            map.addLayer({
                id: 'area-markers-label',
                type: 'symbol',
                source: 'area-markers',
                layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 12,
                    'text-offset': [0, -1.5]
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': '#ef4444',
                    'text-halo-width': 2
                }
            });
        }
    };

    // Store actual polygon points (not just bounds)
    const calculatePolygonFromPoints = (points) => {
        if (points.length < 3) return null;
        // Return the actual points for drawing the polygon
        return { points: [...points] };
    };

    const updateAreaSelectionLayer = (map, areaData) => {
        if (!map || !map.isStyleLoaded()) return; // Guard against invalid map state

        let geojson = { type: 'FeatureCollection', features: [] };

        const ring = toBoundaryRing(areaData);
        if (ring && ring.length >= 4) {
            geojson = {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'Polygon',
                        coordinates: [ring]
                    }
                }]
            };
        } else if (areaData && areaData.minLng !== undefined) {
            // Fallback for old-style bounds (default area)
            geojson = {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [areaData.minLng, areaData.minLat],
                            [areaData.maxLng, areaData.minLat],
                            [areaData.maxLng, areaData.maxLat],
                            [areaData.minLng, areaData.maxLat],
                            [areaData.minLng, areaData.minLat]
                        ]]
                    }
                }]
            };
        } else {
            console.log('No area data to draw');
        }

        try {
            if (map.getSource('area-selection')) {
                map.getSource('area-selection').setData(geojson);
                console.log('Updated area-selection source with', geojson.features.length, 'features');
            } else {
                map.addSource('area-selection', { type: 'geojson', data: geojson });
                // Add layers AFTER other layers to ensure they're on top
                map.addLayer({
                    id: 'area-selection-fill',
                    type: 'fill',
                    source: 'area-selection',
                    paint: {
                        'fill-color': '#ef4444',
                        'fill-opacity': 0.2
                    }
                });
                map.addLayer({
                    id: 'area-selection-outline',
                    type: 'line',
                    source: 'area-selection',
                    paint: {
                        'line-color': '#ef4444',
                        'line-width': 4
                    }
                });
                console.log('Created area-selection source and layers');
            }
        } catch (err) {
            console.error('Error updating area selection layer:', err);
        }
    };

    const syncBoundaryPreviewAndExport = (buildingsGeoJSON, pathwaysGeoJSON, area = selectedArea) => {
        if (!buildingsGeoJSON || !pathwaysGeoJSON) return null;

        const boundaryForExport = toBoundaryFeatureCollection(area)
            || buildBoundaryFromFeatureCollections(buildingsGeoJSON, pathwaysGeoJSON);

        if (!boundaryForExport) {
            if (onPedSimSceneExport) {
                onPedSimSceneExport({
                    status: 'error',
                    message: 'No boundary available to export for PedSim scene.',
                });
            }
            return null;
        }

        if (onMapBoundaryChange) {
            const previewPayload = boundaryForExport
                ? {
                    ...boundaryForExport,
                    preview_buildings: buildingsGeoJSON,
                    preview_pathways: pathwaysGeoJSON,
                }
                : null;
            onMapBoundaryChange(previewPayload);
        }

        const boundaryRing = boundaryForExport?.features?.[0]?.geometry?.coordinates?.[0] || [];
        const payloadSignature = JSON.stringify({
            origin: mapOriginRef.current,
            buildings: buildingsGeoJSON.features?.length || 0,
            pathways: pathwaysGeoJSON.features?.length || 0,
            boundary: boundaryRing,
        });

        if (sceneExportStateRef.current.signature === payloadSignature && sceneExportStateRef.current.inFlight) {
            return boundaryForExport;
        }

        sceneExportStateRef.current = {
            signature: payloadSignature,
            inFlight: true,
        };

        if (onPedSimSceneExport) {
            onPedSimSceneExport({
                status: 'exporting',
                message: 'Exporting map boundary to PedSim scene...',
            });
        }

        exportPedSimSceneFromMap({
            origin_lng: mapOriginRef.current.lng,
            origin_lat: mapOriginRef.current.lat,
            scale: 0.00003,
            buildings: buildingsGeoJSON,
            pathways: pathwaysGeoJSON,
            boundary: boundaryForExport,
            include_agents: true,
            default_agent_count: 120,
        }).then((result) => {
            sceneExportStateRef.current = {
                signature: payloadSignature,
                inFlight: false,
            };

            if (onPedSimSceneExport) {
                onPedSimSceneExport({
                    status: 'ready',
                    ...result,
                });
            }
        }).catch((error) => {
            sceneExportStateRef.current = {
                signature: payloadSignature,
                inFlight: false,
            };

            if (onPedSimSceneExport) {
                onPedSimSceneExport({
                    status: 'error',
                    message: error?.message || 'PedSim scene export failed',
                });
            }
            console.warn('Map to PedSim scene export failed:', error);
        });

        return boundaryForExport;
    };

    const syncCrowdLayerVisibility = (reason) => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;

        const simulator = simRef.current;
        const isSimulationMode = currentMode === 'simulate';
        const isSimActive = Boolean(simulator?.isSimulationActive);
        const agentCount = simulator?.agents?.length || 0;
        // Keep crowd layers enabled in simulate mode so live PedSim dots can appear immediately.
        const showAgents = currentMode !== 'actuate';
        const show2DAgents = currentMode === 'simulate';
        const opacity = isSimulationMode ? 0.95 : currentMode === 'visualize' ? 0.9 : 0.95;
        const snapshot = `${currentMode}|${showAgents}|${show2DAgents}|${isSimActive}|${agentCount}`;
        const safeSetVisibility = (layerId, value) => {
            try {
                if (!map.getLayer(layerId)) return;
                map.setLayoutProperty(layerId, 'visibility', value);
            } catch (error) {
                // Ignore transient style races while map layers are being refreshed.
            }
        };
        const safeSetPaint = (layerId, property, value) => {
            try {
                if (!map.getLayer(layerId)) return;
                map.setPaintProperty(layerId, property, value);
            } catch (error) {
                // Ignore transient style races while map layers are being refreshed.
            }
        };

        if (crowdVisibilityStateRef.current !== snapshot) {
            console.debug('[MapContainer] crowd visibility', {
                reason,
                mode: currentMode,
                showAgents,
                show2DAgents,
                isSimulationActive: isSimActive,
                agentCount,
            });
            crowdVisibilityStateRef.current = snapshot;
        }

        const symbolVisibility = show2DAgents ? 'visible' : 'none';
        safeSetVisibility('crowd-agents-layer', symbolVisibility);

        ['crowd-agents-dot', 'crowd-agents-glow'].forEach((layerId) => {
            const circleVisibility = show2DAgents ? 'visible' : 'none';
            safeSetVisibility(layerId, circleVisibility);
        });

        if (showAgents) {
            safeSetPaint('crowd-agents-layer', 'text-opacity', opacity);
        }

        safeSetPaint('crowd-agents-dot', 'circle-opacity', isSimulationMode ? 0.95 : 0.95);

        safeSetPaint('crowd-agents-glow', 'circle-opacity', isSimulationMode ? 0.24 : 0.18);
    };

    const fetchOverpassData = async (map, centerLng, centerLat) => {
        setLoading(true);
        mapOriginRef.current = { lng: centerLng, lat: centerLat };
        const query = `
      [out:json][timeout:30];
      (
        way["building"](around:350,${centerLat},${centerLng});
        relation["building"](around:350,${centerLat},${centerLng});
        way["landuse"~"grass|forest|meadow"](around:350,${centerLat},${centerLng});
        way["natural"~"grassland|wood|tree_row"](around:350,${centerLat},${centerLng});
        way["leisure"~"park|garden"](around:350,${centerLat},${centerLng});
        way["highway"](around:350,${centerLat},${centerLng});
      );
      out body;>;out skel qt;
    `;

        try {
            const endpoints = [
                'https://overpass-api.de/api/interpreter',
                'https://overpass.kumi.systems/api/interpreter'
            ];

            let geojson = null;
            for (const endpoint of endpoints) {
                try {
                    const formData = new URLSearchParams();
                    formData.append('data', query);
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: formData
                    });

                    if (!response.ok) throw new Error(`status ${response.status}`);

                    const contentType = response.headers.get('content-type') || '';
                    if (!contentType.includes('application/json')) throw new Error('non-json response');

                    const data = await response.json();
                    const parsed = osmtogeojson(data);
                    if (parsed?.features?.length) {
                        geojson = parsed;
                        break;
                    }
                } catch (endpointErr) {
                    console.warn(`Overpass endpoint failed (${endpoint}):`, endpointErr);
                }
            }

            if (!geojson?.features?.length) {
                console.warn('Overpass unavailable or empty response; using fallback map data.');
                geojson = buildFallbackGeojson(centerLng, centerLat);
            }

            const buildings = { type: "FeatureCollection", features: [] };
            const greenAreas = { type: "FeatureCollection", features: [] };
            const pathways = { type: "FeatureCollection", features: [] };

            let serviceRoadCount = 0;

            geojson.features.forEach((feature, index) => {
                const p = feature.properties;
                const name = p.name || p['addr:housename'] || '';

                if (p.building) {
                    const levels = p['building:levels'] ? parseInt(p['building:levels']) : 3;
                    feature.properties.height = levels * 4;
                    feature.properties.base_height = 0;

                    const category = SimulationDB.classifyBuilding(name);
                    feature.properties.category = category;
                    // Assign semantic-tinted realistic color
                    feature.properties.color = SEMANTIC_COLORS[category] || SEMANTIC_COLORS.other;

                    // Calculate center for agent routing
                    if (feature.geometry.type === 'Polygon') {
                        let cx = 0, cy = 0, pts = 0;
                        feature.geometry.coordinates[0].forEach(([x, y]) => { cx += x; cy += y; pts++; });
                        feature.properties.center = [cx / pts, cy / pts];
                    } else if (feature.geometry.type === 'MultiPolygon') {
                        const ring = feature.geometry.coordinates[0][0];
                        let cx = 0, cy = 0, pts = 0;
                        ring.forEach(([x, y]) => { cx += x; cy += y; pts++; });
                        feature.properties.center = [cx / pts, cy / pts];
                    }

                    buildings.features.push(feature);

                } else if (p.landuse || p.natural || p.leisure) {
                    greenAreas.features.push(feature);
                } else if (p.highway) {
                    const normalizedName = (name || '').trim();

                    if (p.highway === 'service' && serviceRoadCount < 10) {
                        serviceRoadCount += 1;
                        feature.properties.road_id = `service_${serviceRoadCount}`;
                        feature.properties.road_name = `Service Road ${serviceRoadCount}`;
                        feature.properties.road_label = String(serviceRoadCount);
                    } else {
                        const fallbackIndex = index + 1;
                        feature.properties.road_id = normalizedName
                            ? normalizedName.toLowerCase().replace(/\s+/g, '_')
                            : `${p.highway}_${fallbackIndex}`;
                        feature.properties.road_name = normalizedName || `${p.highway} ${fallbackIndex}`;
                        feature.properties.road_label = '';
                    }
                    pathways.features.push(feature);
                }
            });

            // Store original data for later filtering
            allBuildingsRef.current = buildings;
            allGreenAreasRef.current = greenAreas;
            allPathwaysRef.current = pathways;

            // Filter buildings by focus area
            const filteredBuildings = selectedArea ? {
                type: 'FeatureCollection',
                features: filterFeaturesByArea(buildings.features, selectedArea)
            } : buildings;

            const filteredGreenAreas = selectedArea ? {
                type: 'FeatureCollection',
                features: greenAreas.features.filter(f => {
                    if (!f.geometry.coordinates) return false;
                    // Get centroid of polygon
                    const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] :
                        f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates[0][0] : [];
                    if (coords.length === 0) return false;
                    let cx = 0, cy = 0;
                    coords.forEach(([x, y]) => { cx += x; cy += y; });
                    const center = { lng: cx / coords.length, lat: cy / coords.length };
                    return isPointInPolygon(center, selectedArea);
                })
            } : greenAreas;
            syncBoundaryPreviewAndExport(filteredBuildings, pathways, selectedArea);

            // ----- Set up MapLibre sources/layers -----
            if (map.getSource('buildings')) {
                // Refresh existing data
                map.getSource('buildings').setData(filteredBuildings);
                map.getSource('greenAreas').setData(filteredGreenAreas);
                map.getSource('pathways').setData(pathways);
            } else {
                // Dark overlay layer for night mode (covers entire viewport)
                map.addSource('dark-overlay', {
                    type: 'geojson',
                    data: {
                        type: 'FeatureCollection',
                        features: [{
                            type: 'Feature',
                            properties: {},
                            geometry: {
                                type: 'Polygon',
                                coordinates: [[
                                    [-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]
                                ]]
                            }
                        }]
                    }
                });
                map.addLayer({
                    id: 'dark-overlay-layer',
                    type: 'fill',
                    source: 'dark-overlay',
                    paint: {
                        'fill-color': '#0a0f1a',
                        'fill-opacity': 0
                    }
                });

                // Green areas
                map.addSource('greenAreas', { type: 'geojson', data: filteredGreenAreas });
                try {
                    map.addLayer({
                        id: 'greenAreas-layer', type: 'fill', source: 'greenAreas',
                        paint: { 'fill-color': '#dcfce7', 'fill-opacity': 0.6 } // Use a light green, semi-transparent fill
                    }, 'waterway');
                } catch (e) {
                    map.addLayer({
                        id: 'greenAreas-layer', type: 'fill', source: 'greenAreas',
                        paint: { 'fill-color': '#dcfce7', 'fill-opacity': 0.6 }
                    });
                }

                // Pathways — visible like city roads
                map.addSource('pathways', { type: 'geojson', data: pathways });
                map.addLayer({
                    id: 'pathways-layer', type: 'line', source: 'pathways',
                    paint: {
                        'line-color': ['case',
                            ['in', ['get', 'highway'], ['literal', ['primary', 'secondary', 'tertiary']]],
                            '#64748b',
                            '#334155'
                        ],
                        'line-width': ['case',
                            ['in', ['get', 'highway'], ['literal', ['primary', 'secondary']]],
                            3, 1.5
                        ],
                        'line-opacity': 0.9
                    }
                });

                map.addLayer({
                    id: 'service-road-labels',
                    type: 'symbol',
                    source: 'pathways',
                    layout: {
                        'text-field': ['get', 'road_label'],
                        'text-size': 11,
                        'symbol-placement': 'line',
                        'text-allow-overlap': true
                    },
                    paint: {
                        'text-color': '#f8fafc',
                        'text-halo-color': '#0f172a',
                        'text-halo-width': 1.2
                    }
                });

                // Streetlights along pathways
                const streetlightPositions = generateStreetlightPositions(pathways, 40);
                const streetlightData = buildStreetlightFeatures(streetlightPositions);

                map.addSource('streetlights', { type: 'geojson', data: streetlightData });

                // Streetlight glow layer (visible at night only)
                map.addLayer({
                    id: 'streetlight-glow',
                    type: 'circle',
                    source: 'streetlights',
                    paint: {
                        'circle-radius': 8,
                        'circle-color': '#fde68a',
                        'circle-opacity': 0,
                        'circle-blur': 0.5
                    }
                });

                // Streetlight icon layer using 𓍙 emoji
                map.addLayer({
                    id: 'streetlight-icon',
                    type: 'symbol',
                    source: 'streetlights',
                    layout: {
                        'text-field': '𓍙',
                        'text-size': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            14, 6,
                            18, 10
                        ],
                        'text-allow-overlap': true
                    },
                    paint: {
                        'text-color': '#a3a3a3',
                        'text-halo-color': 'rgba(0, 0, 0, 0)',
                        'text-halo-width': 0
                    }
                });

                // Camera positions for visualization mode
                const cameraPositions = generateCameraPositions(allBuildingsRef.current || filteredBuildings, allPathwaysRef.current || pathways, 220);
                const cameraData = buildCameraFeatures(cameraPositions);
                const poleData = buildCameraPoleLines(cameraPositions);
                console.log('✅ Cameras:', cameraPositions.length, 'Poles:', poleData.features.length);
                if (cameraPositions.length > 0) {
                    const cam = cameraPositions[0];
                    const pole = poleData.features[0];
                    console.log('  Sample camera:', cam.id, 'at', cam.lng.toFixed(6), cam.lat.toFixed(6));
                    console.log('  Sample pole line:', pole.geometry.coordinates);
                }

                map.addSource('cameras', { type: 'geojson', data: cameraData });
                map.addSource('camera-poles', { type: 'geojson', data: poleData });

                const cameraFeedSignature = cameraPositions
                    .map((camera) => `${camera.id}:${camera.lng.toFixed(6)}:${camera.lat.toFixed(6)}:${camera.type}`)
                    .join('|');
                if (cameraFeedSignatureRef.current !== cameraFeedSignature) {
                    cameraFeedSignatureRef.current = cameraFeedSignature;
                }

                if (modelLayerRef.current) {
                    modelLayerRef.current.placeCameras(cameraPositions);
                }

                // Camera pole lines (simple vertical lines under cameras)
                map.addLayer({
                    id: 'camera-poles-lines',
                    type: 'line',
                    source: 'camera-poles',
                    layout: {
                        'visibility': 'none',
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': '#1e40af',
                        'line-width': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            14, 6,
                            18, 12
                        ],
                        'line-opacity': 0.8
                    }
                });

                // Camera overlay is now rendered by ModelLayer using the GLB asset.

                // Road closure overlay (for actuation mode)
                map.addSource('road-closures', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });

                map.addLayer({
                    id: 'road-closures-highlight',
                    type: 'line',
                    source: 'road-closures',
                    layout: {
                        'visibility': 'none'
                    },
                    paint: {
                        'line-color': ['case',
                            ['==', ['get', 'status'], 'hard_closed'], '#ef4444',
                            ['==', ['get', 'status'], 'soft_closed'], '#f59e0b',
                            '#10b981'
                        ],
                        'line-width': 6,
                        'line-opacity': 0.7
                    }
                });

                // 3D Buildings with semantic color tints
                map.addSource('buildings', { type: 'geojson', data: filteredBuildings });
                map.addLayer({ id: '3d-buildings', source: 'buildings', type: 'fill-extrusion', paint: BUILDING_PAINT });

                // Building interactions
                map.on('mouseenter', '3d-buildings', () => { map.getCanvas().style.cursor = 'pointer'; });
                map.on('mouseleave', '3d-buildings', () => { map.getCanvas().style.cursor = ''; });
                map.on('click', '3d-buildings', e => {
                    if (!e.features.length) return;
                    const feature = e.features[0];
                    map.flyTo({ center: e.lngLat, zoom: 18.5, pitch: 65, speed: 1.5 });
                    const name = feature.properties.name || feature.properties['addr:housename'] || 'Campus Building';
                    onBuildingSelect({ name, properties: feature.properties });
                });

                // Road/pathway interactions - show road name on hover
                let roadPopup = null;

                map.on('mouseenter', 'pathways-layer', e => {
                    map.getCanvas().style.cursor = 'crosshair';

                    if (e.features.length) {
                        const feature = e.features[0];
                        const roadName = feature.properties.road_name ||
                            feature.properties.name ||
                            feature.properties.highway ||
                            'Unnamed Road';
                        const roadType = feature.properties.highway || 'path';
                        const roadId = feature.properties.road_id;
                        const roadStatus = roadStatusByIdRef.current[roadId] || 'open';
                        const statusText = roadStatus === 'hard_closed'
                            ? 'HARD CLOSED'
                            : roadStatus === 'soft_closed'
                                ? 'SOFT CLOSED'
                                : 'OPEN';
                        const statusColor = roadStatus === 'hard_closed'
                            ? '#ef4444'
                            : roadStatus === 'soft_closed'
                                ? '#f59e0b'
                                : '#10b981';

                        // Create popup with road info
                        if (roadPopup) roadPopup.remove();

                        roadPopup = new maplibregl.Popup({
                            closeButton: false,
                            closeOnClick: false,
                            className: 'road-popup'
                        })
                            .setLngLat(e.lngLat)
                            .setHTML(`
                                <div style="padding: 4px 8px; font-size: 12px;">
                                    <strong style="color: #3b82f6;">${roadName}</strong>
                                    <div style="font-size: 10px; color: #9ca3af; text-transform: capitalize;">${roadType}</div>
                                    <div style="font-size: 10px; color: ${statusColor}; font-weight: 700; margin-top: 2px;">${statusText}</div>
                                </div>
                            `)
                            .addTo(map);
                    }
                });

                map.on('mousemove', 'pathways-layer', e => {
                    if (roadPopup && e.features.length) {
                        roadPopup.setLngLat(e.lngLat);
                    }
                });

                map.on('mouseleave', 'pathways-layer', () => {
                    map.getCanvas().style.cursor = '';
                    if (roadPopup) {
                        roadPopup.remove();
                        roadPopup = null;
                    }
                });

                // Store road names for actuation panel
                const roadsToRegister = [];
                const seenRoads = new Set();

                pathways.features.forEach(f => {
                    const roadId = f.properties?.road_id;
                    const roadName = f.properties?.road_name;
                    const highway = f.properties?.highway;

                    if (!String(roadId || '').startsWith('service_')) {
                        return;
                    }

                    if (roadId && !seenRoads.has(roadId)) {
                        seenRoads.add(roadId);
                        roadsToRegister.push({
                            road_id: roadId,
                            road_name: roadName || highway || 'Unnamed Road',
                            road_type: highway || 'path'
                        });
                    }
                });

                if (roadsToRegister.length < 10) {
                    const needed = 10 - roadsToRegister.length;
                    const baseCount = roadsToRegister.length;
                    const fallbackFeatures = pathways.features.slice(0, needed);
                    fallbackFeatures.forEach((feature, idx) => {
                        const serviceNumber = baseCount + idx + 1;
                        const roadId = `service_${serviceNumber}`;
                        if (seenRoads.has(roadId)) return;
                        seenRoads.add(roadId);
                        roadsToRegister.push({
                            road_id: roadId,
                            road_name: `Service Road ${serviceNumber}`,
                            road_type: feature.properties?.highway || 'path'
                        });
                        feature.properties.road_id = roadId;
                        feature.properties.road_name = `Service Road ${serviceNumber}`;
                        feature.properties.road_label = String(serviceNumber);
                    });
                }

                // Register roads with backend
                if (roadsToRegister.length > 0) {
                    registerRoads(roadsToRegister).catch(err => {
                        console.warn('Failed to register roads with backend:', err);
                    });
                    console.log(`MapContainer: Registered ${roadsToRegister.length} roads with backend`);
                }

                // Expose roads to parent via simulator
                if (simRef.current) {
                    simRef.current._availableRoads = roadsToRegister.map(r => r.road_id);
                }


                // Add GLTF model layer (activates when user drops .glb files in public/models/)
                if (!map.getLayer('model-layer-3d')) {
                    const ml = new ModelLayer('model-layer-3d');
                    modelLayerRef.current = ml;
                    map.addLayer(ml); // Renders above everything
                }

                // Expose named buildings to parent
                const namedBuildings = filteredBuildings.features
                    .filter(f => f.properties.name || f.properties['addr:housename'])
                    .map(f => ({ name: f.properties.name || f.properties['addr:housename'] }));
                if (onBuildingsLoaded) onBuildingsLoaded(namedBuildings);
            }

            // Keep the right-panel PedSim preview, but avoid drawing the synthetic
            // PedSim scene over the main geo map to preserve campus context.

            // ----- Start Crowd Simulation -----
            if (simRef.current) {
                simRef.current.stop();
                removeCrowdLayers(map);
            }

            const sim = new CrowdSimulator();
            simRef.current = sim;
            sim.setSimTime(simTime);
            sim.modelLayer = modelLayerRef.current || null; // GLTF instances updated each frame
            sim.init(map, pathways, filteredBuildings, selectedArea);
            sim.setMode(currentMode);

            // Notify parent about simulator instance for live occupancy data
            if (onSimulatorReady) onSimulatorReady(sim);

            syncCrowdLayerVisibility('map-data-loaded');

            // Build tree positions from green areas (use filtered green areas)
            let treePositions = [];
            filteredGreenAreas.features.forEach(feature => {
                if (feature.geometry.type === 'Polygon') {
                    const outerRing = feature.geometry.coordinates[0];
                    const targetCount = Math.max(20, Math.min(150, outerRing.length * 6));
                    treePositions.push(...sampleTreePositionsFromRing(outerRing, targetCount));
                } else if (feature.geometry.type === 'MultiPolygon') {
                    feature.geometry.coordinates.forEach(poly => {
                        const outerRing = poly[0];
                        const targetCount = Math.max(20, Math.min(150, outerRing.length * 6));
                        treePositions.push(...sampleTreePositionsFromRing(outerRing, targetCount));
                    });
                }
            });

            // Plant trees in ModelLayer (if available)
            if (modelLayerRef.current) {
                modelLayerRef.current.placeTrees(treePositions);
            }

            // Always draw visible white triangle trees as a map overlay fallback
            const treePoints = buildTreePointFeatures(treePositions);

            const isPointInsideAnyBuilding = (point, buildings) => {
                for (const b of buildings.features) {
                    if (!b.geometry) continue;

                    if (b.geometry.type === 'Polygon') {
                        if (isPointInRing(point, b.geometry.coordinates[0])) {
                            return true;
                        }
                    }

                    if (b.geometry.type === 'MultiPolygon') {
                        for (const poly of b.geometry.coordinates) {
                            if (isPointInRing(point, poly[0])) {
                                return true;
                            }
                        }
                    }
                }
                return false;
            };

            if (map.getSource('tree-emoji')) {
                map.getSource('tree-emoji').setData(treePoints);
            } else {
                map.addSource('tree-emoji', {
                    type: 'geojson',
                    data: treePoints
                });
                map.addLayer({
                    id: 'tree-emoji-layer',
                    type: 'symbol',
                    source: 'tree-emoji',
                    layout: {
                        'text-field': ['get', 'icon'],
                        'text-size': [
                            'interpolate',
                            ['linear'],
                            ['zoom'],
                            14, 14,
                            18, 24
                        ],
                        'text-allow-overlap': false
                    },
                    paint: {
                        'text-color': '#166534',
                        'text-halo-color': '#dcfce7',
                        'text-halo-width': 1.2
                    }
                });
            }

        } catch (err) {
            console.error("Overpass fetch failed:", err);
        } finally {
            setLoading(false);
        }
    };

    // Initialize map once
    useEffect(() => {
        if (mapRef.current) return;

        const initialLng = Number.isFinite(mapLng) ? mapLng : 78.3487;
        const initialLat = Number.isFinite(mapLat) ? mapLat : 17.4464;

        mapRef.current = new maplibregl.Map({
            container: mapContainerRef.current,
            // style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            center: [initialLng, initialLat],
            zoom: 16.5,
            pitch: 58,
            bearing: -20,
            antialias: true,
        });

        mapRef.current.on('load', () => {
            fetchOverpassData(mapRef.current, initialLng, initialLat);
            // Initialize area selection layer with current selectedArea (if any)
            updateAreaSelectionLayer(mapRef.current, selectedArea);
            // Initialize point markers layer (must be inside load callback)
            updatePointMarkersLayer(mapRef.current, areaPoints || []);
        });

        // Navigation controls
        mapRef.current.addControl(new maplibregl.NavigationControl(), 'bottom-left');
    }, []);

    useEffect(() => {
        if (onMapLoadingChange) {
            onMapLoadingChange(loading);
        }
    }, [loading, onMapLoadingChange]);

    useEffect(() => {
        if (!teleportRequestId || !mapRef.current) return;
        if (!Number.isFinite(mapLat) || !Number.isFinite(mapLng)) return;

        mapRef.current.jumpTo({ center: [mapLng, mapLat] });
        fetchOverpassData(mapRef.current, mapLng, mapLat);
    }, [teleportRequestId, mapLat, mapLng]);

    // Update simTime in sim engine and MapLibre sun
    useEffect(() => {
        if (simRef.current) simRef.current.setSimTime(simTime);
        if (modelLayerRef.current) modelLayerRef.current.setSimTime(simTime);

        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;

        const hour = simTime;
        const isDay = hour >= 6 && hour <= 19;
        const dayCurve = Math.sin(((hour - 6) / 13) * Math.PI);

        // Calculate dark overlay opacity - fast linear transition
        // Dawn: 5:30-6:30, Dusk: 18:30-19:30, Full night: 19:30-5:30, Full day: 6:30-18:30
        let darkOverlayOpacity = 0;
        const maxDarkness = 0.4;

        if (hour >= 0 && hour < 5.5) {
            darkOverlayOpacity = maxDarkness; // Night
        } else if (hour >= 5.5 && hour < 6.5) {
            // Dawn - fast linear fade out (1 hour)
            darkOverlayOpacity = maxDarkness * (6.5 - hour);
        } else if (hour >= 6.5 && hour < 18.5) {
            darkOverlayOpacity = 0; // Day
        } else if (hour >= 18.5 && hour < 19.5) {
            // Dusk - fast linear fade in (1 hour)
            darkOverlayOpacity = maxDarkness * (hour - 18.5);
        } else {
            darkOverlayOpacity = maxDarkness; // Night
        }

        // Apply dark overlay for night mode
        if (map.getLayer('dark-overlay-layer')) {
            map.setPaintProperty('dark-overlay-layer', 'fill-opacity', darkOverlayOpacity);
        }

        // MapLibre native light = drives building shading
        try {
            map.setLight({
                anchor: 'map',
                color: isDay
                    ? '#ffffff'
                    : '#1e293b',
                intensity: isDay
                    ? Math.min(1.0, 0.6 + (dayCurve * 0.6))
                    : 0.15,
                position: [1.5, 180 - (dayCurve * 120), 60]
            });
        } catch (e) { /* style may not have light support */ }

        // Streetlight glow effect - visible at night only (7PM to 6AM)
        // Calculate smooth transition: 0 during day, gradual increase at dusk, gradual decrease at dawn
        let lightIntensity = 0;
        if (hour >= 19 || hour < 5) {
            // Full night (7PM-5AM): lights fully on
            lightIntensity = 0.4;
        } else if (hour >= 18 && hour < 19) {
            // Dusk transition (6PM-7PM): fade in
            lightIntensity = (hour - 18) * 0.4;
        } else if (hour >= 5 && hour < 6) {
            // Dawn transition (5AM-6AM): fade out
            lightIntensity = (6 - hour) * 0.4;
        }
        // Morning (6AM-6PM): lights off

        const glowRadius = lightIntensity > 0 ? 10 : 6;

        if (map.getLayer('streetlight-glow')) {
            map.setPaintProperty('streetlight-glow', 'circle-opacity', lightIntensity);
            map.setPaintProperty('streetlight-glow', 'circle-radius', glowRadius);
        }

        if (map.getLayer('streetlight-icon')) {
            // At night: warm yellow glow, during day: gray/off appearance
            const iconColor = lightIntensity > 0 ? '#fde68a' : '#a3a3a3';
            const haloWidth = lightIntensity > 0 ? 3 : 0;
            const haloColor = lightIntensity > 0 ? 'rgba(253, 230, 138, 0.3)' : 'rgba(0, 0, 0, 0)';

            map.setPaintProperty('streetlight-icon', 'text-color', iconColor);
            map.setPaintProperty('streetlight-icon', 'text-halo-width', haloWidth);
            map.setPaintProperty('streetlight-icon', 'text-halo-color', haloColor);
            map.setLayoutProperty('streetlight-icon', 'text-size', [
                'interpolate', ['linear'], ['zoom'],
                14, 6,
                18, 10
            ]);
        }

    }, [simTime]);

    // Handle mode changes - show/hide appropriate layers and control simulation
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;

        // Mode-specific layer visibility and simulation behavior
        const showCameras = currentMode === 'visualize';
        const showRoadClosures = currentMode === 'actuate' || currentMode === 'simulate';

        // Toggle camera visibility
        if (map.getLayer('camera-icon')) {
            map.setLayoutProperty('camera-icon', 'visibility', showCameras ? 'visible' : 'none');
        }
        if (map.getLayer('camera-glow')) {
            map.setLayoutProperty('camera-glow', 'visibility', showCameras ? 'visible' : 'none');
        }
        // Toggle camera pole visibility (all pole structures)
        if (map.getLayer('camera-poles-lines')) {
            map.setLayoutProperty('camera-poles-lines', 'visibility', showCameras ? 'visible' : 'none');
        }
        if (map.getLayer('camera-pole-base')) {
            map.setLayoutProperty('camera-pole-base', 'visibility', showCameras ? 'visible' : 'none');
        }


        // Toggle road closures visibility
        if (map.getLayer('road-closures-highlight')) {
            map.setLayoutProperty('road-closures-highlight', 'visibility', showRoadClosures ? 'visible' : 'none');
        }

        // Handle crowd simulation based on mode
        if (simRef.current) {
            const sim = simRef.current;

            if (currentMode === 'visualize') {
                // Visualization mode uses synthetic node data but renders moving people models.
                sim.setMode('visualize');
            } else if (currentMode === 'actuate') {
                // Actuation mode: Hide agents (focus on road controls)
                sim.setMode('actuate');
            } else if (currentMode === 'simulate') {
                sim.setMode('simulate');
            }
        }

        syncCrowdLayerVisibility('mode-change');

        console.log(`MapContainer: Mode changed to ${currentMode}`);

    }, [currentMode]);

    // Visualization mode: map synthetic node readings to moving human agents.
    // Helper: Match camera to closest building by name or proximity
    const matchCameraToBuilding = (camera, buildings) => {
        if (!camera || !buildings?.features) return null;

        const cameraName = String(camera.location_name || '').toLowerCase();
        const cameraLng = Number(camera.lng);
        const cameraLat = Number(camera.lat);

        // Try exact name match first
        for (const building of buildings.features) {
            const buildingName = String(building.properties?.name || '').toLowerCase();
            const buildingNameAlt = String(building.properties?.['addr:housename'] || '').toLowerCase();
            
            if (buildingName.includes(cameraName) || cameraName.includes(buildingName) ||
                buildingNameAlt.includes(cameraName) || cameraName.includes(buildingNameAlt)) {
                return building;
            }
        }

        // Fall back to closest building by distance
        if (!Number.isFinite(cameraLng) || !Number.isFinite(cameraLat)) return null;

        let closestBuilding = null;
        let minDistance = Infinity;

        for (const building of buildings.features) {
            const center = building.properties?.center;
            if (!Array.isArray(center) || center.length < 2) continue;

            const buildingLng = center[0];
            const buildingLat = center[1];
            const dist = Math.hypot(cameraLng - buildingLng, cameraLat - buildingLat);

            if (dist < minDistance) {
                minDistance = dist;
                closestBuilding = building;
            }
        }

        return closestBuilding;
    };

    // Helper: Get or create agents for a camera across semantically matching buildings
    const spawnAgentsFromCamera = (camera, buildings) => {
        if (!camera) return [];

        const targetCount = Math.max(0, Math.floor(Number(camera.people_count) || 0));
        const cameraId = normalizeCameraId(camera);
        const zoneColors = {
            hostel: '#2563eb',
            girls_hostel: '#8b5cf6',
            classroom: '#dc2626',
            research: '#f59e0b',
            lab: '#f59e0b',
            canteen: '#ea580c',
            residential: '#94a3b8',
            venue: '#ec4899',
            gate: '#16a34a',
            road: '#16a34a',
            other: '#6366f1'
        };

        const agentColor = zoneColors[camera.zone] || zoneColors.other;
        const candidateBuildings = getCameraBuildingCandidates(camera, buildings);
        const currentStates = syntheticAgentStateRef.current.get(cameraId) || [];

        if (candidateBuildings.length === 0) {
            syntheticAgentStateRef.current.set(cameraId, currentStates);
            return [];
        }

        while (currentStates.length < targetCount) {
            const building = candidateBuildings[currentStates.length % candidateBuildings.length];
            const nextState = buildSyntheticAgentState(camera, building, currentStates.length);
            if (!nextState) break;
            currentStates.push(nextState);
        }

        if (currentStates.length > targetCount) {
            currentStates.length = targetCount;
        }

        const agents = currentStates.map((state) => {
            const advancedState = advanceSyntheticAgentState(state, camera, state.currentBuilding);
            return {
                id: advancedState.id,
                cohortId: 'synthetic',
                color: agentColor,
                path: [{ lng: advancedState.lng, lat: advancedState.lat }],
                pathIndex: 0,
                lng: advancedState.lng,
                lat: advancedState.lat,
                progress: 0,
                speed: 0,
                state: 'STATIONARY',
                cameraSource: cameraId,
                currentBuilding: state.currentBuilding || null,
                targetBuilding: null,
            };
        });

        syntheticAgentStateRef.current.set(cameraId, currentStates);
        return agents;
    };

    useEffect(() => {
        if (currentMode !== 'visualize') return;

        let cancelled = false;
        let fetchTimer = null;

        const fetchSynthetic = async () => {
            try {
                const payload = await getSyntheticCameras(1);
                if (cancelled) return;

                const simulator = simRef.current;
                if (!simulator) return;

                const buildings = allBuildingsRef.current;
                if (!buildings?.features) return;

                const cameras = Array.isArray(payload?.cameras)
                    ? payload.cameras.filter((camera) => Number(camera?.people_count) > 0)
                    : [];
                syntheticCamerasRef.current = cameras;

                const nextStates = new Map();
                const updatedAgents = [];
                for (const camera of cameras) {
                    const cameraAgents = spawnAgentsFromCamera(camera, buildings);
                    updatedAgents.push(...cameraAgents);
                    const cameraId = normalizeCameraId(camera);
                    nextStates.set(cameraId, syntheticAgentStateRef.current.get(cameraId) || []);
                }

                syntheticAgentStateRef.current = nextStates;

                simulator.agents = updatedAgents;
                simulator._updateLayer();
                simulator.modelLayer?.updateAgents(simulator.agents);
            } catch (error) {
                console.debug('Visualization fetch error:', error);
                // Keep previous snapshot when backend is temporarily unavailable.
            }
        };

        fetchSynthetic();
        fetchTimer = setInterval(fetchSynthetic, 100);

        return () => {
            cancelled = true;
            if (fetchTimer) clearInterval(fetchTimer);
            syntheticAgentStateRef.current = new Map();

            const simulator = simRef.current;
            if (simulator) {
                simulator.agents = simulator.agents.filter((agent) => !isSyntheticAgent(agent));
                simulator._updateLayer();
                simulator.modelLayer?.updateAgents(simulator.agents);
            }
        };
    }, [currentMode]);

    // Update last feed time display in visualization mode
    useEffect(() => {
        if (currentMode !== 'visualize') return;

        const updateLastFeedTime = async () => {
            try {
                const data = await getBuildingOccupancy();

                // Get the most recent timestamp from building occupancy data
                if (data.buildings && Object.keys(data.buildings).length > 0) {
                    const timestamps = Object.values(data.buildings)
                        .map(b => new Date(b.last_updated))
                        .filter(t => !isNaN(t.getTime()))
                        .sort((a, b) => b - a);

                    if (timestamps.length > 0) {
                        const lastTime = timestamps[0];
                        const timeStr = lastTime.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: undefined,
                            hour12: true
                        });

                        const lastFeedEl = document.getElementById('last-feed-time');
                        if (lastFeedEl) {
                            lastFeedEl.textContent = timeStr;
                        }
                    }
                }
            } catch (error) {
                console.log('Could not fetch last feed time:', error);
            }
        };

        // Update immediately and then every 5 seconds
        updateLastFeedTime();
        const interval = setInterval(updateLastFeedTime, 5000);

        return () => clearInterval(interval);

    }, [currentMode]);

    // Monitor simulation active state to show/hide agents
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded() || currentMode !== 'simulate') return;

        const pollInterval = setInterval(() => {
            syncCrowdLayerVisibility('simulate-poll');
        }, 250);

        return () => clearInterval(pollInterval);
    }, [currentMode]);

    // Sync road closure states from backend and reflect on map
    useEffect(() => {
        const syncRoadClosures = async () => {
            try {
                const roadsData = await getAvailableRoads();
                const roads = roadsData?.roads || [];

                const statusMap = {};
                roads.forEach(road => {
                    statusMap[road.road_id] = road.status || 'open';
                });
                roadStatusByIdRef.current = statusMap;

                const map = mapRef.current;
                const pathways = allPathwaysRef.current;
                if (!map || !pathways || !map.getSource('road-closures')) {
                    return;
                }

                const closedRoadIds = new Set(
                    roads
                        .filter(road => road.status && road.status !== 'open')
                        .map(road => road.road_id)
                );

                const closedFeatures = pathways.features
                    .filter(feature => closedRoadIds.has(feature.properties?.road_id))
                    .map(feature => ({
                        ...feature,
                        properties: {
                            ...feature.properties,
                            status: statusMap[feature.properties?.road_id] || 'open'
                        }
                    }));

                map.getSource('road-closures').setData({
                    type: 'FeatureCollection',
                    features: closedFeatures
                });
            } catch (error) {
                console.log('Road closure sync skipped:', error);
            }
        };

        syncRoadClosures();
        const interval = setInterval(syncRoadClosures, 3000);
        return () => clearInterval(interval);
    }, []);
    // Handle map click for placing points
    const handleMapClick = (e) => {
        if (!isPlacingPoints) return;

        const newPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        const newPoints = [...areaPoints, newPoint];

        setAreaPoints(newPoints);

        if (newPoints.length === 4) {
            const polygon = {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    geometry: {
                        type: "Polygon",
                        coordinates: [[
                            ...newPoints.map(p => [p.lng, p.lat]),
                            [newPoints[0].lng, newPoints[0].lat] // close polygon
                        ]]
                    }
                }]
            };

            setSelectedArea(polygon);
            setIsPlacingPoints(false);
        }
    };

    // Add click handler when point placement mode changes
    useEffect(() => {
        if (!mapRef.current) return;

        if (isPlacingPoints) {
            mapRef.current.on('click', handleMapClick);
            mapRef.current.getCanvas().style.cursor = 'crosshair';
        } else {
            mapRef.current.off('click', handleMapClick);
            mapRef.current.getCanvas().style.cursor = '';
        }

        return () => {
            if (mapRef.current) {
                mapRef.current.off('click', handleMapClick);
            }
        };
    }, [isPlacingPoints, areaPoints]);

    // Sync map cursor with isPlacingPoints state
    useEffect(() => {
        if (!mapRef.current) return;
        mapRef.current.getCanvas().style.cursor = isPlacingPoints ? 'crosshair' : '';
    }, [isPlacingPoints]);

    // Sync map layers with selectedArea state
    useEffect(() => {
        if (!mapRef.current) return;

        console.log('selectedArea changed:', selectedArea);

        // Ensure map style is loaded before updating layers
        const updateLayers = () => {
            if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
                console.log('Map style not loaded, waiting...');
                if (mapRef.current) {
                    mapRef.current.once('styledata', updateLayers);
                }
                return;
            }

            updateAreaSelectionLayer(mapRef.current, selectedArea);

            // Re-filter buildings and green areas when selectedArea changes
            if (allBuildingsRef.current && allGreenAreasRef.current && allPathwaysRef.current) {
                const buildings = allBuildingsRef.current;
                const greenAreas = allGreenAreasRef.current;
                const pathways = allPathwaysRef.current;

                // Filter by selected area
                const filteredBuildings = selectedArea ? {
                    ...buildings,
                    features: buildings.features.filter(feature => {
                        const center = feature.properties?.center;
                        if (!center) return false;
                        return isPointInPolygon({ lng: center[0], lat: center[1] }, selectedArea);
                    })
                } : buildings;

                const filteredGreenAreas = selectedArea ? {
                    ...greenAreas,
                    features: greenAreas.features.filter(feature => {
                        // Get center of green area for filtering
                        let center;
                        if (feature.geometry.type === 'Polygon') {
                            const coords = feature.geometry.coordinates[0];
                            const lngSum = coords.reduce((s, c) => s + c[0], 0);
                            const latSum = coords.reduce((s, c) => s + c[1], 0);
                            center = { lng: lngSum / coords.length, lat: latSum / coords.length };
                        } else if (feature.geometry.type === 'MultiPolygon') {
                            const firstPoly = feature.geometry.coordinates[0][0];
                            const lngSum = firstPoly.reduce((s, c) => s + c[0], 0);
                            const latSum = firstPoly.reduce((s, c) => s + c[1], 0);
                            center = { lng: lngSum / firstPoly.length, lat: latSum / firstPoly.length };
                        }
                        if (!center) return false;
                        return isPointInPolygon(center, selectedArea);
                    })
                } : greenAreas;

                // Update map sources
                if (mapRef.current.getSource('buildings')) {
                    mapRef.current.getSource('buildings').setData(filteredBuildings);
                }
                if (mapRef.current.getSource('greenAreas')) {
                    mapRef.current.getSource('greenAreas').setData(filteredGreenAreas);
                }

                syncBoundaryPreviewAndExport(filteredBuildings, pathways, selectedArea);

                // Restart simulation with filtered buildings
                if (simRef.current) {
                    simRef.current.stop();
                    removeCrowdLayers(mapRef.current);

                    const sim = new CrowdSimulator();
                    simRef.current = sim;
                    sim.setSimTime(simTime);
                    sim.modelLayer = modelLayerRef.current || null;
                    sim.init(mapRef.current, pathways, filteredBuildings, selectedArea);
                    sim.setMode(currentMode);

                    // Notify parent about new simulator instance
                    if (onSimulatorReady) onSimulatorReady(sim);
                    syncCrowdLayerVisibility('selected-area-change');
                }
            }
        };

        updateLayers();
    }, [selectedArea]);

    // Sync point markers with areaPoints state
    useEffect(() => {
        if (!mapRef.current || !mapRef.current.isStyleLoaded()) return;
        updatePointMarkersLayer(mapRef.current, areaPoints);
    }, [areaPoints]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>

            {/* Point placement hint */}
            {isPlacingPoints && (
                <div className="glass-panel" style={{
                    position: 'absolute', top: '145px', left: '20px',
                    padding: '8px 12px', zIndex: 100, fontSize: '0.75rem', color: '#facc15'
                }}>
                    Click to place point {areaPoints.length + 1}/4
                </div>
            )}

            {/* Legend */}
            <div className="glass-panel" style={{
                position: 'absolute', bottom: '20px', left: '20px',
                padding: '12px 16px', zIndex: 100, minWidth: '120px'
            }}>
                {/* Show cohorts only in actuate/simulate modes - cameras can't detect cohorts */}
                {currentMode === 'simulate' && (
                    <>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.05em' }}>COHORTS</div>
                        {COHORTS.map(c => (
                            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: c.color, boxShadow: `0 0 4px ${c.color}` }} />
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{c.name}</span>
                            </div>
                        ))}
                    </>
                )}
                {/* In visualization mode, show single color indicator and last feed time */}
                {currentMode === 'visualize' && (
                    <>
                        <div style={{ marginBottom: '10px' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.05em' }}>PEOPLE</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 4px #6366f1' }} />
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Detected via cameras</span>
                            </div>
                        </div>
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(148,163,184,0.35)' }}>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>LIVE FEED → LAST FEED</div>
                            <div id="last-feed-time" style={{ fontSize: '0.85rem', fontWeight: '600', color: '#60a5fa', marginTop: '4px' }}>
                                Loading...
                            </div>
                        </div>
                    </>
                )}
                <div style={{ marginTop: currentMode !== 'visualize' ? '10px' : 10, paddingTop: currentMode !== 'visualize' ? '8px' : 8, borderTop: '1px solid rgba(148,163,184,0.35)', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    BUILDINGS
                </div>
                {Object.entries(SEMANTIC_COLORS).map(([cat, color]) => (
                    <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <div style={{ width: '10px', height: '6px', borderRadius: '2px', background: color }} />
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{cat}</span>
                    </div>
                ))}
            </div>

            <div ref={mapContainerRef} className="map-container" />
        </div>
    );
}
