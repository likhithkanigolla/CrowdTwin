import { useState, useEffect, useRef } from 'react';
import { getSyntheticCameras } from '../api';

// Zone colour mapping
const ZONE_COLORS = {
    hostel: '#60a5fa', // blue
    girls_hostel: '#f472b6', // pink
    classroom: '#fbbf24', // amber
    research: '#a78bfa', // violet
    lab: '#34d399', // emerald
    canteen: '#f97316', // orange
    residential: '#94a3b8', // slate
    venue: '#22d3ee', // cyan
    gate: '#4ade80', // green
    road: '#64748b', // grey
    other: '#e2e8f0', // light grey
};

const zoneColor = (zone) => ZONE_COLORS[zone] || ZONE_COLORS.other;

// Tiny spark bar (width proportional to count)
const Bar = ({ count, max }) => {
    const pct = max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0;
    const color = pct > 80 ? '#ef4444' : pct > 55 ? '#f59e0b' : '#22c55e';
    return (
        <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', flex: 1 }}>
            <div style={{
                width: `${pct}%`,
                height: '100%',
                background: color,
                borderRadius: '2px',
                transition: 'width 0.8s ease',
            }} />
        </div>
    );
};

export default function LiveCameraPanel({ compact = false }) {
    const [cameras, setCameras] = useState([]);
    const [total, setTotal] = useState(0);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [error, setError] = useState(null);
    const intervalRef = useRef(null);

    const fetchData = async () => {
        try {
            const data = await getSyntheticCameras(3);
            // data.cameras is an array of {camera_id, location_name, people_count, zone, lat, lng}
            const cams = Array.isArray(data?.cameras) ? data.cameras : [];
            // Sort by people_count desc
            cams.sort((a, b) => (b.people_count || 0) - (a.people_count || 0));
            setCameras(cams);
            setTotal(cams.reduce((s, c) => s + (c.people_count || 0), 0));
            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            setError('Seeder offline');
        }
    };

    useEffect(() => {
        fetchData();
        intervalRef.current = setInterval(fetchData, 2000);
        return () => clearInterval(intervalRef.current);
    }, []);

    const maxCount = cameras.length > 0 ? Math.max(...cameras.map(c => c.people_count || 0)) : 1;

    const panelStyle = {
        background: 'rgba(15,23,42,0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: compact ? '12px' : '16px',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#e2e8f0',
    };

    return (
        <div style={panelStyle}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: error ? '#ef4444' : '#22c55e',
                        boxShadow: error ? 'none' : '0 0 6px #22c55e',
                        animation: error ? 'none' : 'pulse 2s infinite',
                    }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.04em' }}>
                        LIVE CAMERAS
                    </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
                </div>
            </div>

            {/* Total counter */}
            <div style={{
                background: 'rgba(255,255,255,0.04)',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'baseline',
                gap: '8px',
            }}>
                <span style={{ fontSize: '1.8rem', fontWeight: 700, color: '#60a5fa', lineHeight: 1 }}>
                    {total.toLocaleString()}
                </span>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>people visible</span>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#475569' }}>
                    {cameras.length} cameras
                </span>
            </div>

            {/* Error state */}
            {error && (
                <div style={{
                    padding: '8px 12px',
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    color: '#fca5a5',
                }}>
                    ⚠ {error} — start iiith_seeder.py
                </div>
            )}

            {/* Camera list */}
            {!error && (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    maxHeight: compact ? '200px' : '340px',
                    overflowY: 'auto',
                    paddingRight: '2px',
                }}>
                    {cameras.length === 0 && (
                        <div style={{ fontSize: '0.8rem', color: '#475569', textAlign: 'center', padding: '16px 0' }}>
                            Waiting for seeder data…
                        </div>
                    )}
                    {cameras.map((cam) => (
                        <div key={cam.camera_id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 8px',
                            borderRadius: '6px',
                            background: 'rgba(255,255,255,0.03)',
                            transition: 'background 0.2s',
                        }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                        >
                            {/* Zone dot */}
                            <div style={{
                                width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                                background: zoneColor(cam.zone),
                            }} />

                            {/* Name + bar */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: '0.78rem',
                                    color: '#cbd5e1',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    marginBottom: '3px',
                                }}>
                                    {cam.location_name}
                                </div>
                                <Bar count={cam.people_count || 0} max={maxCount} />
                            </div>

                            {/* Count badge */}
                            <div style={{
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                color: '#e2e8f0',
                                minWidth: '32px',
                                textAlign: 'right',
                                flexShrink: 0,
                            }}>
                                {(cam.people_count || 0).toLocaleString()}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
        </div>
    );
}
