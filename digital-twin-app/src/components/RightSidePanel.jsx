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

// Panel styles - now flows within 30% panel section
const panelStyle = {
    flex: 1.5,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    background: 'rgba(43, 10, 189, 0.03)',
    
};

// ======================
// VISUALIZE MODE - Analytics Dashboard
// ======================
function VisualizePanel({ simTime, formatTime, categoryOccupancy }) {
    const totalPeople = Object.values(categoryOccupancy).reduce((sum, val) => sum + val, 0);
    
    return (
        <div style={panelStyle}>
            {/* Time Display */}
            <div style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '8px',
                padding: '12px',
                textAlign: 'center'
            }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>
                    🕐 Current Time
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(simTime)}
                </div>
            </div>

            {/* Quick Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '6px',
                    padding: '10px',
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#10b981' }}>
                        {totalPeople}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        Active People
                    </div>
                </div>
                <div style={{
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '6px',
                    padding: '10px',
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#f59e0b' }}>
                        {Object.keys(categoryOccupancy).length}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        Active Zones
                    </div>
                </div>
            </div>

            {/* Category Breakdown */}
            {Object.keys(categoryOccupancy).length > 0 && (
                <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
                        Zone Occupancy
                    </div>
                    <div style={{ fontSize: '0.75rem' }}>
                        {Object.entries(categoryOccupancy).map(([cat, count]) => {
                            const max = 600;
                            const pct = Math.min(100, (count / max) * 100);
                            const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
                            return (
                                <div key={cat} style={{ marginBottom: '6px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                        <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{cat}</span>
                                        <span style={{ color, fontWeight: 600 }}>{count}</span>
                                    </div>
                                    <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '2px', height: '4px', overflow: 'hidden' }}>
                                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.5s ease' }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ======================
// ACTUATE MODE - Active Actuation Events
// ======================
function ActuatePanel({ simTime, formatTime, congestionAlerts, actuationEvents, setActuationEvents }) {
    const [showAlerts, setShowAlerts] = useState(true);
    const [showEvents, setShowEvents] = useState(true);

    const removeEvent = (idx) => {
        setActuationEvents(prev => prev.filter((_, i) => i !== idx));
    };

    return (
        <div style={panelStyle}>
            {/* Time Display */}
            <div style={{
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                borderRadius: '8px',
                padding: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>🕐 Time</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(simTime)}
                </span>
            </div>

            {/* Active Actuation Events */}
            <div>
                <button
                    onClick={() => setShowEvents(!showEvents)}
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
                    <span>🎯 Active Events ({actuationEvents.length})</span>
                    <span>{showEvents ? '▼' : '▶'}</span>
                </button>
                {showEvents && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                        {actuationEvents.length === 0 ? (
                            <div style={{ 
                                padding: '12px', 
                                textAlign: 'center', 
                                color: 'var(--text-secondary)', 
                                fontSize: '0.75rem',
                                background: 'rgba(255,255,255,0.03)',
                                borderRadius: '4px'
                            }}>
                                No active actuation events
                            </div>
                        ) : (
                            actuationEvents.map((event, i) => (
                                <div key={i} style={{
                                    background: 'rgba(139, 92, 246, 0.1)',
                                    border: '1px solid rgba(139, 92, 246, 0.3)',
                                    padding: '8px 10px',
                                    borderRadius: '4px',
                                    fontSize: '0.75rem',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 700, color: '#c4b5fd' }}>{event.name}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                                            {event.building} • {event.attendees} people
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeEvent(i)}
                                        style={{
                                            background: 'rgba(239, 68, 68, 0.2)',
                                            border: 'none',
                                            color: '#ef4444',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '0.7rem'
                                        }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))
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
        </div>
    );
}

// ======================
// SIMULATE MODE - Configuration Panel
// ======================
function SimulatePanel({ 
    simTime, 
    setSimTime, 
    isRunning, 
    setIsRunning, 
    speed, 
    setSpeed, 
    formatTime, 
    availableBuildings,
    congestionAlerts,
    categoryOccupancy
}) {
    const [eventName, setEventName] = useState('');
    const [attendees, setAttendees] = useState(100);
    const [suggestion, setSuggestion] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showAlerts, setShowAlerts] = useState(false);
    const [showOccupancy, setShowOccupancy] = useState(false);

    const SPEED_OPTIONS = [
        { label: '1×', value: 1 },
        { label: '5×', value: 5 },
        { label: '15×', value: 15 },
        { label: '60×', value: 60 },
    ];

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
            alert("Failed to connect to FastAPI backend.");
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
        <div style={panelStyle}>
            {/* Time Controls */}
            <div style={{
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                borderRadius: '8px',
                padding: '12px',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>🕐 Virtual Time</span>
                    <span style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(simTime)}
                    </span>
                </div>

                {/* Timeline scrubber */}
                <input
                    type="range"
                    min="0"
                    max="23.99"
                    step="0.0833"
                    value={simTime}
                    onChange={(e) => setSimTime(parseFloat(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-blue)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    <span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>12AM</span>
                </div>

                {/* Controls row */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '10px' }}>
                    <button
                        onClick={() => setIsRunning(r => !r)}
                        style={{
                            padding: '5px 12px',
                            background: isRunning ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)',
                            border: `1px solid ${isRunning ? '#ef4444' : '#10b981'}`,
                            color: isRunning ? '#ef4444' : '#10b981',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            minWidth: '60px'
                        }}
                    >
                        {isRunning ? '⏸' : '▶'}
                    </button>
                    <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
                        {SPEED_OPTIONS.map(opt => (
                            <button
                                key={opt.label}
                                onClick={() => { setSpeed(opt.value); setIsRunning(true); }}
                                style={{
                                    flex: 1,
                                    padding: '5px 0',
                                    background: speed === opt.value && isRunning ? 'var(--accent-blue)' : 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    color: speed === opt.value && isRunning ? 'white' : 'var(--text-secondary)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.7rem'
                                }}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Collapsible Alerts */}
            {congestionAlerts.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowAlerts(!showAlerts)}
                        style={{
                            width: '100%',
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            padding: '6px 10px',
                            borderRadius: '5px',
                            color: '#fca5a5',
                            fontSize: '0.75rem',
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                            {congestionAlerts.slice(0, 3).map((alert, i) => (
                                <div key={i} style={{
                                    background: SEVERITY_BG[alert.severity],
                                    borderLeft: `3px solid ${SEVERITY_COLORS[alert.severity]}`,
                                    padding: '6px 8px',
                                    borderRadius: '3px',
                                    fontSize: '0.65rem',
                                }}>
                                    <div style={{ fontWeight: 700, color: SEVERITY_COLORS[alert.severity] }}>{alert.location}</div>
                                    <div style={{ color: 'var(--text-secondary)' }}>{alert.recommendation}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Collapsible Occupancy */}
            {Object.keys(categoryOccupancy).length > 0 && (
                <div>
                    <button
                        onClick={() => setShowOccupancy(!showOccupancy)}
                        style={{
                            width: '100%',
                            background: 'rgba(59, 130, 246, 0.08)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            padding: '6px 10px',
                            borderRadius: '5px',
                            color: '#93c5fd',
                            fontSize: '0.75rem',
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
                        <div style={{ paddingTop: '6px', fontSize: '0.7rem' }}>
                            {Object.entries(categoryOccupancy).map(([cat, count]) => {
                                const pct = Math.min(100, (count / 600) * 100);
                                const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
                                return (
                                    <div key={cat} style={{ marginBottom: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>{cat}</span>
                                            <span style={{ color }}>{count}</span>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '2px', height: '3px' }}>
                                            <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px' }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Event Simulation */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase' }}>
                    Plan Event
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input
                        type="text"
                        placeholder="Event Name"
                        value={eventName}
                        onChange={e => setEventName(e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.75rem' }}
                    />
                    <input
                        type="number"
                        placeholder="Attendees"
                        value={attendees}
                        onChange={e => setAttendees(e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.75rem' }}
                    />
                    <button
                        onClick={getSuggestion}
                        disabled={loading}
                        style={{ padding: '7px', background: 'var(--accent-blue)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.75rem' }}
                    >
                        {loading ? '⏳ Analyzing...' : '🤖 Get Suggestion'}
                    </button>
                </div>
            </div>

            {suggestion && (
                <div style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    padding: '10px',
                    borderRadius: '5px',
                }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', marginBottom: '8px' }}>
                        <strong>✅ {suggestion.suggested_building}</strong><br />
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>{suggestion.reason}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={scheduleEvent} style={{ flex: 1, padding: '5px', background: 'var(--accent-green)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.7rem' }}>
                            Schedule
                        </button>
                        <button onClick={() => setSuggestion(null)} style={{ flex: 1, padding: '5px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--text-secondary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}>
                            Reject
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ======================
// MAIN COMPONENT
// ======================
export default function RightSidePanel({ 
    mode, 
    simTime, 
    setSimTime,
    isRunning,
    setIsRunning,
    speed,
    setSpeed,
    formatTime,
    availableBuildings,
    actuationEvents,
    setActuationEvents,
    // Focus Area props
    isPlacingPoints,
    areaPoints,
    selectedArea,
    togglePointPlacement,
    useDefaultArea,
    clearAreaSelection
}) {
    const [congestionAlerts, setCongestionAlerts] = useState([]);
    const [categoryOccupancy, setCategoryOccupancy] = useState({});

    // Auto-fetch congestion data when simTime changes
    useEffect(() => {
        const loadCongestion = async () => {
            try {
                const data = await fetchCongestion(simTime);
                setCongestionAlerts(data.alerts || []);
                setCategoryOccupancy(data.category_occupancy || {});
            } catch (err) {
                // Backend might not be running
            }
        };
        loadCongestion();
    }, [Math.floor(simTime)]);

    // Header content based on mode
    const getModeHeader = () => {
        switch(mode) {
            case 'visualize':
                return { icon: '📊', title: 'Analytics', subtitle: 'Real-time metrics' };
            case 'actuate':
                return { icon: '⚡', title: 'Actuation', subtitle: 'Control systems' };
            case 'simulate':
                return { icon: '🎮', title: 'Simulation', subtitle: 'Time control' };
            default:
                return { icon: '🏙️', title: 'Digital Twin', subtitle: 'Campus view' };
        }
    };
    
    const header = getModeHeader();

    const renderContent = () => {
        if (mode === 'visualize') {
            return (
                <VisualizePanel 
                    simTime={simTime} 
                    formatTime={formatTime} 
                    categoryOccupancy={categoryOccupancy}
                />
            );
        }

        if (mode === 'actuate') {
            return (
                <ActuatePanel 
                    simTime={simTime} 
                    formatTime={formatTime}
                    congestionAlerts={congestionAlerts}
                    actuationEvents={actuationEvents}
                    setActuationEvents={setActuationEvents}
                />
            );
        }

        if (mode === 'simulate') {
            return (
                <SimulatePanel 
                    simTime={simTime}
                    setSimTime={setSimTime}
                    isRunning={isRunning}
                    setIsRunning={setIsRunning}
                    speed={speed}
                    setSpeed={setSpeed}
                    formatTime={formatTime}
                    availableBuildings={availableBuildings}
                    congestionAlerts={congestionAlerts}
                    categoryOccupancy={categoryOccupancy}
                />
            );
        }

        return null;
    };

    return (
        <>
            <div className="panel-header">
                <h2>
                    <span>{header.icon}</span>
                    {header.title}
                </h2>
                <div className="subtitle">{header.subtitle}</div>
            </div>
            {renderContent()}
            
            {/* Focus Area Section */}
            {/* <div style={{
                borderTop: '1px solid rgba(59, 130, 246, 0.2)',
                padding: '12px 16px',
                marginTop: 'auto',
                background: 'rgba(59, 130, 246, 0.05)'
            }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
                    📍 Focus Area
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                        onClick={togglePointPlacement}
                        style={{
                            padding: '5px 10px',
                            background: isPlacingPoints ? 'rgba(239, 68, 68, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                            border: `1px solid ${isPlacingPoints ? '#ef4444' : '#3b82f6'}`,
                            color: isPlacingPoints ? '#ef4444' : '#3b82f6',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                            fontWeight: 600
                        }}
                    >
                        {isPlacingPoints ? '✕ Cancel' : '📍 Set Points'}
                    </button>
                    <button
                        onClick={useDefaultArea}
                        style={{
                            padding: '5px 10px',
                            background: 'rgba(16, 185, 129, 0.2)',
                            border: '1px solid #10b981',
                            color: '#10b981',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                            fontWeight: 600
                        }}
                    >
                        Default
                    </button>
                    {(selectedArea || areaPoints?.length > 0) && (
                        <button
                            onClick={clearAreaSelection}
                            style={{
                                padding: '5px 10px',
                                background: 'rgba(156, 163, 175, 0.2)',
                                border: '1px solid #9ca3af',
                                color: '#9ca3af',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.7rem',
                                fontWeight: 600
                            }}
                        >
                            Clear
                        </button>
                    )}
                </div>
                {selectedArea && selectedArea.points && (
                    <div style={{ marginTop: '8px', fontSize: '0.65rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {selectedArea.points.map((pt, idx) => (
                            <div key={idx}>P{idx + 1}: {pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}</div>
                        ))}
                    </div>
                )}
                {isPlacingPoints && (
                    <div style={{ marginTop: '6px', fontSize: '0.65rem', color: '#facc15' }}>
                        Click map to place point {(areaPoints?.length || 0) + 1}/4
                    </div>
                )}
            </div> */}
        </>
    );
}
