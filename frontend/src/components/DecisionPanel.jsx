import { useState, useEffect } from 'react';
import { createEvent, fetchCongestion, suggestBuilding } from '../api';

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

export default function DecisionPanel({ availableBuildings, simTime }) {
    const [eventName, setEventName] = useState('');
    const [attendees, setAttendees] = useState(100);
    const [suggestion, setSuggestion] = useState(null);
    const [loading, setLoading] = useState(false);
    const [congestionAlerts, setCongestionAlerts] = useState([]);
    const [categoryOccupancy, setCategoryOccupancy] = useState({});
    const [showAlerts, setShowAlerts] = useState(true);
    const [showOccupancy, setShowOccupancy] = useState(false);

    // Auto-fetch congestion alerts when simTime changes
    useEffect(() => {
        const loadCongestion = async () => {
            try {
                const data = await fetchCongestion(simTime);
                setCongestionAlerts(data.alerts || []);
                setCategoryOccupancy(data.category_occupancy || {});
            } catch (err) {
                // Backend might not be running, ignore
            }
        };
        loadCongestion();
    }, [Math.floor(simTime)]); // Only update when hour changes

    const getSuggestion = async () => {
        if (!availableBuildings || availableBuildings.length === 0) {
            alert("No buildings loaded yet.");
            return;
        }
        setLoading(true);
        try {
            const data = await suggestBuilding({
                name: eventName || 'New Event',
                attendees: parseInt(attendees, 10),
                buildings: availableBuildings,
                sim_time: simTime,
            });
            setSuggestion(data);
        } catch (err) {
            console.error(err);
            alert("Failed to connect to FastAPI backend. Ensure it is running on port 8000.");
        } finally {
            setLoading(false);
        }
    };

    const scheduleEvent = async () => {
        if (!suggestion) return;
        try {
            await createEvent({
                name: eventName || 'New Event',
                building_name: suggestion.suggested_building,
                attendees: parseInt(attendees, 10),
                time: new Date().toISOString()
            });
            alert(`Event scheduled at ${suggestion.suggested_building}!`);
            setSuggestion(null);
            setEventName('');
        } catch (err) {
            console.error(err);
        }
    };

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
            <h3 style={{ fontSize: '1rem', marginBottom: '8px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '1.1rem' }}>⚡</span> Simulation
            </h3>

            {/* Collapsible Congestion Alerts */}
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
                            {congestionAlerts.slice(0, 3).map((alert, i) => (
                                <div key={i} style={{
                                    background: SEVERITY_BG[alert.severity],
                                    border: `1px solid ${SEVERITY_COLORS[alert.severity]}40`,
                                    borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity]}`,
                                    padding: '8px 10px',
                                    borderRadius: '4px',
                                    fontSize: '0.7rem',
                                }}>
                                    <div style={{ fontWeight: 700, color: SEVERITY_COLORS[alert.severity], marginBottom: '2px' }}>
                                        {alert.location}
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

            {/* Collapsible Category Occupancy */}
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

            {/* Event Simulation Section */}
            <div style={{
                borderTop: '1px solid rgba(255,255,255,0.1)',
                paddingTop: '10px',
            }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase' }}>
                    Plan Event
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input
                        type="text"
                        placeholder="Event Name"
                        value={eventName}
                        onChange={e => setEventName(e.target.value)}
                        style={{ padding: '7px 10px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.8rem' }}
                    />
                    <input
                        type="number"
                        placeholder="Attendees"
                        value={attendees}
                        onChange={e => setAttendees(e.target.value)}
                        style={{ padding: '7px 10px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.8rem' }}
                    />
                    <button
                        onClick={getSuggestion}
                        disabled={loading}
                        style={{ padding: '8px', background: 'var(--accent-blue)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem' }}
                    >
                        {loading ? '⏳ Analyzing...' : '🤖 Get Suggestion'}
                    </button>
                </div>
            </div>

            {suggestion && (
                <div style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    padding: '12px',
                    borderRadius: '6px',
                }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginBottom: '10px', lineHeight: '1.4' }}>
                        <strong>✅ {suggestion.suggested_building}</strong><br />
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{suggestion.reason}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={scheduleEvent} style={{ flex: 1, padding: '6px', background: 'var(--accent-green)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem' }}>
                            Schedule
                        </button>
                        <button onClick={() => setSuggestion(null)} style={{ flex: 1, padding: '6px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--text-secondary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                            Reject
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
