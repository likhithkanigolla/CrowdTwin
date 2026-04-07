import { useState, useEffect } from 'react';
import { fetchCongestion } from '../api';

const SEVERITY_COLORS = {
    critical: '#ef4444',
    high: '#f59e0b',
    medium: '#3b82f6',
    low: '#10b981',
};

const SEVERITY_BG = {
    critical: 'rgba(239, 68, 68, 0.1)',
    high: 'rgba(245, 158, 11, 0.1)',
    medium: 'rgba(59, 130, 246, 0.1)',
    low: 'rgba(16, 185, 129, 0.1)',
};

export default function SimulationPanel({ simTime }) {
    const [activeMovements, setActiveMovements] = useState([]);
    const [congestionAlerts, setCongestionAlerts] = useState([]);
    const [categoryOccupancy, setCategoryOccupancy] = useState({});
    const [showAlerts, setShowAlerts] = useState(true);
    const [showOccupancy, setShowOccupancy] = useState(true);
    const [showMovements, setShowMovements] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    
    // Configurable settings
    const [minAttendees, setMinAttendees] = useState(0);
    const [filterPriority, setFilterPriority] = useState('all');

    // Auto-fetch live movements and congestion when simTime changes
    useEffect(() => {
        const loadData = async () => {
            try {
                // Fetch congestion data
                const congestion = await fetchCongestion(simTime);
                setCongestionAlerts(congestion.alerts || []);
                setCategoryOccupancy(congestion.category_occupancy || {});

                // Fetch live movements
                const response = await fetch(`http://localhost:8000/live-movements?sim_time=${simTime}`);
                const movementData = await response.json();
                setActiveMovements(movementData.active_movements || []);
            } catch (err) {
                console.error('Error loading simulation data:', err);
            }
        };
        loadData();
    }, [simTime]);

    // Filter movements based on settings
    const filteredMovements = activeMovements.filter(movement => {
        if (movement.attendees < minAttendees) return false;
        if (filterPriority !== 'all' && movement.priority !== filterPriority) return false;
        return true;
    });

    return (
        <div className="glass-panel" style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            width: '340px',
            maxHeight: '85vh',
            overflowY: 'auto',
            padding: '16px',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
        }}>
            <h3 style={{ 
                fontSize: '1rem', 
                marginBottom: '8px', 
                color: 'var(--text-primary)', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px' 
            }}>
                <span style={{ fontSize: '1.1rem' }}>📊</span> Live Simulation
            </h3>

            {/* Settings Panel */}
            <div>
                <button
                    onClick={() => setShowSettings(!showSettings)}
                    style={{
                        width: '100%',
                        background: 'rgba(139, 92, 246, 0.08)',
                        border: '1px solid rgba(139, 92, 246, 0.3)',
                        padding: '8px 10px',
                        borderRadius: '5px',
                        color: '#c4b5fd',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}
                >
                    <span>⚙️ Settings</span>
                    <span>{showSettings ? '▼' : '▶'}</span>
                </button>
                {showSettings && (
                    <div style={{
                        marginTop: '8px',
                        padding: '10px',
                        background: 'rgba(139, 92, 246, 0.05)',
                        border: '1px solid rgba(139, 92, 246, 0.2)',
                        borderRadius: '5px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                    }}>
                        {/* Min Attendees Filter */}
                        <div>
                            <label style={{
                                display: 'block',
                                fontSize: '0.7rem',
                                color: 'var(--text-secondary)',
                                marginBottom: '4px',
                                fontWeight: 600
                            }}>
                                Min Attendees: {minAttendees}
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="500"
                                step="10"
                                value={minAttendees}
                                onChange={(e) => setMinAttendees(parseInt(e.target.value))}
                                style={{
                                    width: '100%',
                                    cursor: 'pointer',
                                    accentColor: 'var(--accent-blue)'
                                }}
                            />
                        </div>

                        {/* Priority Filter */}
                        <div>
                            <label style={{
                                display: 'block',
                                fontSize: '0.7rem',
                                color: 'var(--text-secondary)',
                                marginBottom: '4px',
                                fontWeight: 600
                            }}>
                                Priority Filter
                            </label>
                            <select
                                value={filterPriority}
                                onChange={(e) => setFilterPriority(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '6px 8px',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    borderRadius: '4px',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.75rem',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="all">All Priorities</option>
                                <option value="critical">Critical Only</option>
                                <option value="high">High Only</option>
                                <option value="medium">Medium Only</option>
                                <option value="low">Low Only</option>
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Active Movements (From CSV) */}
            <div>
                <button
                    onClick={() => setShowMovements(!showMovements)}
                    style={{
                        width: '100%',
                        background: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        padding: '8px 10px',
                        borderRadius: '5px',
                        color: '#6ee7b7',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}
                >
                    <span>🚶 Active Events ({filteredMovements.length}/{activeMovements.length})</span>
                    <span>{showMovements ? '▼' : '▶'}</span>
                </button>
                {showMovements && (
                    <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '6px', 
                        marginTop: '8px',
                        maxHeight: '200px',
                        overflowY: 'auto'
                    }}>
                        {filteredMovements.length > 0 ? (
                            filteredMovements.map((movement, i) => (
                                <div key={i} style={{
                                    background: 'rgba(16, 185, 129, 0.08)',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    padding: '8px 10px',
                                    borderRadius: '4px',
                                    fontSize: '0.7rem',
                                }}>
                                    <div style={{ 
                                        fontWeight: 700, 
                                        color: '#6ee7b7', 
                                        marginBottom: '4px' 
                                    }}>
                                        {movement.event_name}
                                    </div>
                                    <div style={{ 
                                        color: 'var(--text-secondary)', 
                                        lineHeight: '1.4',
                                        fontSize: '0.65rem'
                                    }}>
                                        📍 {movement.from_location} → {movement.venue}<br/>
                                        👥 {movement.attendees} people<br/>
                                        ⏰ {movement.start_time} - {movement.end_time}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{
                                padding: '12px',
                                textAlign: 'center',
                                color: 'var(--text-secondary)',
                                fontSize: '0.75rem'
                            }}>
                                No active movements at this time
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Congestion Alerts */}
            {congestionAlerts.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowAlerts(!showAlerts)}
                        style={{
                            width: '100%',
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            padding: '8px 10px',
                            borderRadius: '5px',
                            color: '#fca5a5',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}
                    >
                        <span>🔴 Alerts ({congestionAlerts.length})</span>
                        <span>{showAlerts ? '▼' : '▶'}</span>
                    </button>
                    {showAlerts && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                            {congestionAlerts.map((alert, i) => (
                                <div key={i} style={{
                                    background: SEVERITY_BG[alert.severity],
                                    border: `1px solid ${SEVERITY_COLORS[alert.severity]}40`,
                                    borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity]}`,
                                    padding: '8px 10px',
                                    borderRadius: '4px',
                                    fontSize: '0.7rem',
                                }}>
                                    <div style={{ fontWeight: 700, color: SEVERITY_COLORS[alert.severity], marginBottom: '2px' }}>
                                        {alert.location} - {alert.time}
                                    </div>
                                    <div style={{ color: 'var(--text-secondary)', lineHeight: '1.3' }}>
                                        {alert.recommendation}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Category Occupancy */}
            {Object.keys(categoryOccupancy).length > 0 && (
                <div>
                    <button
                        onClick={() => setShowOccupancy(!showOccupancy)}
                        style={{
                            width: '100%',
                            background: 'rgba(59, 130, 246, 0.08)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            padding: '8px 10px',
                            borderRadius: '5px',
                            color: '#93c5fd',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}
                    >
                        <span>📊 Occupancy</span>
                        <span>{showOccupancy ? '▼' : '▶'}</span>
                    </button>
                    {showOccupancy && (
                        <div style={{ paddingTop: '8px', fontSize: '0.75rem' }}>
                            {Object.entries(categoryOccupancy).map(([cat, count]) => {
                                const max = 600;
                                const pct = Math.min(100, (count / max) * 100);
                                const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
                                return (
                                    <div key={cat} style={{ marginBottom: '5px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1px' }}>
                                            <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{cat}</span>
                                            <span style={{ color }}>{count}</span>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '2px', height: '3px', overflow: 'hidden' }}>
                                            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.5s ease' }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
