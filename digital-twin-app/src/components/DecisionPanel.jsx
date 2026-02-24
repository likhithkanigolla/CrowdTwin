import { useState, useEffect } from 'react';

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

    // Auto-fetch congestion alerts when simTime changes
    useEffect(() => {
        const fetchCongestion = async () => {
            try {
                const resp = await fetch(`http://localhost:8000/congestion?sim_time=${simTime}`);
                if (resp.ok) {
                    const data = await resp.json();
                    setCongestionAlerts(data.alerts || []);
                    setCategoryOccupancy(data.category_occupancy || {});
                }
            } catch (err) {
                // Backend might not be running, ignore
            }
        };
        fetchCongestion();
    }, [Math.floor(simTime)]); // Only update when hour changes

    const getSuggestion = async () => {
        if (!availableBuildings || availableBuildings.length === 0) {
            alert("No buildings loaded yet.");
            return;
        }
        setLoading(true);
        try {
            const resp = await fetch('http://localhost:8000/suggest-building', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: eventName || 'New Event',
                    attendees: parseInt(attendees),
                    buildings: availableBuildings
                })
            });
            const data = await resp.json();
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
            await fetch('http://localhost:8000/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: eventName || 'New Event',
                    building_name: suggestion.suggested_building,
                    attendees: parseInt(attendees),
                    time: new Date().toISOString()
                })
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
            width: '380px',
            maxHeight: '80vh',
            overflowY: 'auto',
            padding: '24px',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
        }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>⚡</span> Simulation Intelligence
            </h3>

            {/* Congestion Alerts */}
            {congestionAlerts.length > 0 && (
                <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>ACTIVE CONGESTION ALERTS</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {congestionAlerts.map((alert, i) => (
                            <div key={i} style={{
                                background: SEVERITY_BG[alert.severity],
                                border: `1px solid ${SEVERITY_COLORS[alert.severity]}40`,
                                borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity]}`,
                                padding: '10px 12px',
                                borderRadius: '6px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 700, color: SEVERITY_COLORS[alert.severity], fontSize: '0.85rem' }}>
                                        {alert.location} — {alert.count} people
                                    </span>
                                    <span style={{
                                        background: SEVERITY_COLORS[alert.severity],
                                        color: 'white',
                                        fontSize: '0.65rem',
                                        padding: '2px 6px',
                                        borderRadius: '10px',
                                        fontWeight: 700,
                                        textTransform: 'uppercase'
                                    }}>{alert.severity}</span>
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                                    {alert.recommendation}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Category Occupancy Mini-Chart */}
            {Object.keys(categoryOccupancy).length > 0 && (
                <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>ZONE OCCUPANCY</div>
                    {Object.entries(categoryOccupancy).map(([cat, count]) => {
                        const max = 600;
                        const pct = Math.min(100, (count / max) * 100);
                        const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
                        return (
                            <div key={cat} style={{ marginBottom: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                                    <span style={{ textTransform: 'capitalize' }}>{cat}</span>
                                    <span style={{ color }}>{count}</span>
                                </div>
                                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '2px', height: '4px', overflow: 'hidden' }}>
                                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.5s ease' }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Divider */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: 600 }}>EVENT SIMULATION ENGINE</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                        type="text"
                        placeholder="Event Name (e.g. Felicity 2026)"
                        value={eventName}
                        onChange={e => setEventName(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.85rem' }}
                    />
                    <input
                        type="number"
                        placeholder="Expected Attendees"
                        value={attendees}
                        onChange={e => setAttendees(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.85rem' }}
                    />
                    <button
                        onClick={getSuggestion}
                        disabled={loading}
                        style={{ padding: '10px', background: 'var(--accent-blue)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                    >
                        {loading ? 'Analyzing...' : 'Get AI Placement Suggestion'}
                    </button>
                </div>
            </div>

            {suggestion && (
                <div style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    padding: '16px',
                    borderRadius: '8px',
                }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '12px', lineHeight: '1.5' }}>
                        <strong>✅ Suggested: {suggestion.suggested_building}</strong><br />
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{suggestion.reason}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={scheduleEvent} style={{ flex: 1, padding: '8px', background: 'var(--accent-green)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}>
                            Approve &amp; Route
                        </button>
                        <button onClick={() => setSuggestion(null)} style={{ flex: 1, padding: '8px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--text-secondary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                            Reject
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
