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
        way["building"](around:900,${centerLat},${centerLng});
        relation["building"](around:900,${centerLat},${centerLng});
        way["landuse"~"grass|forest|meadow"](around:900,${centerLat},${centerLng});
        way["natural"~"grassland|wood|tree_row"](around:900,${centerLat},${centerLng});
        way["leisure"~"park|garden"](around:900,${centerLat},${centerLng});
        way["highway"](around:900,${centerLat},${centerLng});
      );
      out body;>;out skel qt;
    `;

        try {
            const formData = new URLSearchParams();
            formData.append('data', query);
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            });

            if (!response.ok) throw new Error(`Overpass API Error: ${response.status}`);
            const contentType = response.headers.get("content-type");
            if (!contentType?.includes("application/json")) throw new Error('Overpass did not return JSON');

            const data = await response.json();
            const geojson = osmtogeojson(data);

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
                        paint: { 'fill-color': '#052e16', 'fill-opacity': 0.7 }
                    }, 'waterway');
                } catch (e) {
                    map.addLayer({
                        id: 'greenAreas-layer', type: 'fill', source: 'greenAreas',
                        paint: { 'fill-color': '#052e16', 'fill-opacity': 0.7 }
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

            // Plant trees in ModelLayer
            if (modelLayerRef.current) {
                const treePositions = [];
                greenAreas.features.forEach(feature => {
                    if (feature.geometry.type === 'Polygon') {
                        const coords = feature.geometry.coordinates[0];
                        for (let i = 0; i < coords.length; i += 3) {
                            treePositions.push({ lng: coords[i][0], lat: coords[i][1] });
                        }
                    }
                });
                modelLayerRef.current.placeTrees(treePositions);
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
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
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
                    ? (hour < 8 ? '#ffb347' : hour > 17 ? '#ff7f50' : '#ffffff')
                    : '#0d0d1a',
                intensity: isDay ? Math.max(0.05, dayCurve * 0.9) : 0.02,
                position: [1.5, 180 - (dayCurve * 90), Math.max(10, dayCurve * 70)]
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
