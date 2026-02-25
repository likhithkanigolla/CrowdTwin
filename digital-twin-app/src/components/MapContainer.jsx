import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import osmtogeojson from 'osmtogeojson';
import { CrowdSimulator, COHORTS } from '../engine/CrowdSimulator';
import { ModelLayer } from '../engine/ModelLayer';
import { SimulationDB } from '../engine/SimulationDB';

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
        const lng = minLng + Math.random() * (maxLng - minLng);
        const lat = minLat + Math.random() * (maxLat - minLat);
        if (isPointInRing([lng, lat], ring)) {
            points.push({ lng, lat });
        }
    }

    return points;
};

const TREE_EMOJIS = ['🌳', '🌲', '🌴'];

const buildTreePointFeatures = (treePositions) => {
    return {
        type: 'FeatureCollection',
        features: treePositions.map((t, idx) => ({
            type: 'Feature',
            properties: {
                id: idx,
                icon: TREE_EMOJIS[Math.floor(Math.random() * TREE_EMOJIS.length)]
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

export default function MapContainer({ currentMode, onBuildingSelect, onBuildingsLoaded, simTime }) {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const simRef = useRef(null);       // CrowdSimulator instance 
    const modelLayerRef = useRef(null); // GLTF ModelLayer instance
    const [loading, setLoading] = useState(false);

    const [lng, setLng] = useState(78.3483);
    const [lat, setLat] = useState(17.4455);

    const fetchOverpassData = async (map, centerLng, centerLat) => {
        setLoading(true);
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

            geojson.features.forEach(feature => {
                const p = feature.properties;
                const name = p.name || p['addr:housename'] || '';

                if (p.building) {
                    const levels = p['building:levels'] ? parseInt(p['building:levels']) : (Math.floor(Math.random() * 4) + 1);
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
                    pathways.features.push(feature);
                }
            });

            // ----- Set up MapLibre sources/layers -----
            if (map.getSource('buildings')) {
                // Refresh existing data
                map.getSource('buildings').setData(buildings);
                map.getSource('greenAreas').setData(greenAreas);
                map.getSource('pathways').setData(pathways);
            } else {
                // Green areas
                map.addSource('greenAreas', { type: 'geojson', data: greenAreas });
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

                // 3D Buildings with semantic color tints
                map.addSource('buildings', { type: 'geojson', data: buildings });
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

                // Add GLTF model layer (activates when user drops .glb files in public/models/)
                if (!map.getLayer('model-layer-3d')) {
                    const ml = new ModelLayer('model-layer-3d');
                    modelLayerRef.current = ml;
                    map.addLayer(ml); // Renders above everything
                }

                // Expose named buildings to parent
                const namedBuildings = buildings.features
                    .filter(f => f.properties.name || f.properties['addr:housename'])
                    .map(f => ({ name: f.properties.name || f.properties['addr:housename'] }));
                if (onBuildingsLoaded) onBuildingsLoaded(namedBuildings);
            }

            // ----- Start Crowd Simulation -----
            if (simRef.current) {
                simRef.current.stop();
                // Remove old crowd layers to allow re-init
                ['crowd-agents-dot', 'crowd-agents-glow'].forEach(id => {
                    if (map.getLayer(id)) map.removeLayer(id);
                });
                if (map.getSource('crowd-agents')) map.removeSource('crowd-agents');
            }

            const sim = new CrowdSimulator();
            simRef.current = sim;
            sim.setSimTime(simTime);
            sim.modelLayer = modelLayerRef.current || null; // GLTF instances updated each frame
            sim.init(map, pathways, buildings);

            // Populate green areas with stationary agents
            sim.populateGreenAreas(greenAreas);

            // Build tree positions from green areas
            let treePositions = [];
            greenAreas.features.forEach(feature => {
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

        mapRef.current = new maplibregl.Map({
            container: mapContainerRef.current,
            // style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            center: [lng, lat],
            zoom: 16.5,
            pitch: 58,
            bearing: -20,
            antialias: true,
        });

        mapRef.current.on('load', () => {
            fetchOverpassData(mapRef.current, lng, lat);
        });

        // Navigation controls
        mapRef.current.addControl(new maplibregl.NavigationControl(), 'bottom-left');
    }, []);

    // Update simTime in sim engine and MapLibre sun
    useEffect(() => {
        if (simRef.current) simRef.current.setSimTime(simTime);
        if (modelLayerRef.current) modelLayerRef.current.setSimTime(simTime);

        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;

        const hour = simTime;
        const isDay = hour >= 6 && hour <= 19;
        const dayCurve = Math.sin(((hour - 6) / 13) * Math.PI);

        // MapLibre native light = drives building shading
        try {
            map.setLight({
                anchor: 'map',
                color: isDay
                    ? '#ffffff'
                    : '#1e293b',
                intensity: isDay
                    ? 0.6 + (dayCurve * 0.6)
                    : 0.15,
                position: [1.5, 180 - (dayCurve * 120), 60]
            });
        } catch (e) { /* style may not have light support */ }

    }, [simTime]);

    const handleTeleport = () => {
        if (mapRef.current) {
            mapRef.current.jumpTo({ center: [lng, lat] });
            fetchOverpassData(mapRef.current, lng, lat);
        }
    };

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>

            {/* Coordinate bar */}
            <div className="glass-panel" style={{
                position: 'absolute', top: '20px', left: '20px',
                padding: '12px', zIndex: 100, display: 'flex', gap: '8px', alignItems: 'center'
            }}>
                {loading && <span style={{ marginRight: '8px', color: '#facc15', fontSize: '0.75rem' }}>⏳ Loading...</span>}
                <input type="number" value={lat} onChange={e => setLat(parseFloat(e.target.value))}
                    style={{ width: '90px', padding: '6px', borderRadius: '4px', border: 'none', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: '0.85rem' }}
                    placeholder="LAT" />
                <input type="number" value={lng} onChange={e => setLng(parseFloat(e.target.value))}
                    style={{ width: '90px', padding: '6px', borderRadius: '4px', border: 'none', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: '0.85rem' }}
                    placeholder="LNG" />
                <button style={{ padding: '6px 14px', background: 'var(--accent-blue)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                    onClick={handleTeleport} disabled={loading}>
                    Teleport
                </button>
            </div>

            {/* Legend */}
            <div className="glass-panel" style={{
                position: 'absolute', bottom: '20px', left: '20px',
                padding: '12px 16px', zIndex: 100, minWidth: '120px'
            }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.05em' }}>COHORTS</div>
                {COHORTS.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: c.color, boxShadow: `0 0 4px ${c.color}` }} />
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{c.name}</span>
                    </div>
                ))}
                <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
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
