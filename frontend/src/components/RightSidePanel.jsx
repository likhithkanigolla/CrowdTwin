import { useState, useEffect, useRef } from 'react';
import { 
    createEvent, 
    fetchCongestion, 
    suggestBuilding,
    getCameraFeed,
    controlRoad,
    getRoadStatus,
    getAvailableRoads,
    resetRoad,
    addClassroomRequirement,
    getActuationRules,
    addActuationRule,
    evaluateActuation,
    createSimulationConfig,
    evaluateSimulation
} from '../api';

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
// VISUALIZE MODE - Live Camera Feed & Real Data Dashboard
// ======================
function VisualizePanel({ mode, simTime, formatTime, categoryOccupancy, onSimulatorAction }) {
    const totalPeople = Object.values(categoryOccupancy).reduce((sum, val) => sum + val, 0);
    const [cameraData, setCameraData] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [showCameras, setShowCameras] = useState(true);
    const [lastFeedTime, setLastFeedTime] = useState('--:--');

    // Poll camera data periodically
    useEffect(() => {
        const fetchCameras = async () => {
            try {
                const data = await getCameraFeed();
                const cameras = data.cameras || [];
                setCameraData(cameras);

                const latestTimestamp = cameras
                    .map(camera => new Date(camera.timestamp))
                    .filter(timestamp => !Number.isNaN(timestamp.getTime()))
                    .sort((left, right) => right.getTime() - left.getTime())[0];

                if (latestTimestamp) {
                    setLastFeedTime(
                        latestTimestamp.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                        })
                    );
                }
            } catch (err) {
                // Backend might not be running
            }
        };
        fetchCameras();
        const interval = setInterval(fetchCameras, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div style={panelStyle}>
            {/* Live Feed Indicator */}
            <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '8px',
                padding: '12px',
                textAlign: 'center'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ 
                        width: '8px', 
                        height: '8px', 
                        borderRadius: '50%', 
                        background: '#10b981',
                        animation: 'pulse 2s infinite'
                    }}></span>
                    <span style={{ color: '#10b981', fontSize: '0.75rem', fontWeight: 600 }}>LIVE FEED → LAST FEED</span>
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                    {lastFeedTime}
                </div>
            </div>

            {/* Quick Stats Grid */}
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
                        Tracked People
                    </div>
                </div>
                <div style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '6px',
                    padding: '10px',
                    textAlign: 'center'
                }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#ef4444' }}>
                        📹 {cameraData.length || Object.keys(categoryOccupancy).length * 2}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        Active Cameras
                    </div>
                </div>
            </div>

            {/* Camera Feed Section */}
            <div>
                <button
                    onClick={() => setShowCameras(!showCameras)}
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
                    <span>📹 Camera Tracking</span>
                    <span>{showCameras ? '▼' : '▶'}</span>
                </button>
                {showCameras && (
                    <div style={{ marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                        <div style={{ 
                            padding: '8px', 
                            background: 'rgba(0,0,0,0.2)', 
                            borderRadius: '4px',
                            marginBottom: '8px'
                        }}>
                            📍 Cameras placed at building entrances and road segments track people movement between locations.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {Object.entries(categoryOccupancy).map(([zone, count]) => (
                                <div key={zone} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '6px 8px',
                                    background: 'rgba(255,255,255,0.03)',
                                    borderRadius: '4px'
                                }}>
                                    <span style={{ textTransform: 'capitalize' }}>📹 {zone}</span>
                                    <span style={{ 
                                        color: count > 100 ? '#ef4444' : count > 50 ? '#f59e0b' : '#10b981',
                                        fontWeight: 600 
                                    }}>
                                        {count} people
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Zone Occupancy from Live Data */}
            {Object.keys(categoryOccupancy).length > 0 && (
                <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
                        📊 Real-Time Zone Occupancy
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

            {/* Note about hidden agents */}
            <div style={{
                padding: '10px',
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '6px',
                fontSize: '0.7rem',
                color: 'var(--text-secondary)'
            }}>
                💡 <strong>Note:</strong> People inside buildings are hidden from view. Only movement between camera points is tracked.
            </div>
        </div>
    );
}

// ======================
// ACTUATE MODE - Control Panel
// ======================
function ActuatePanel({ simTime, formatTime, congestionAlerts, actuationEvents, setActuationEvents, onSimulatorAction }) {
    const [showAlerts, setShowAlerts] = useState(true);
    const [showEvents, setShowEvents] = useState(true);
    const [showRoadControl, setShowRoadControl] = useState(true);
    const [showClassroom, setShowClassroom] = useState(false);
    const [showRules, setShowRules] = useState(false);
    
    // Road control state
    const [roadStatus, setRoadStatus] = useState([]);
    const [availableRoads, setAvailableRoads] = useState([]);
    const [selectedRoad, setSelectedRoad] = useState('');
    const [roadAction, setRoadAction] = useState('soft_closed');
    const [roadReason, setRoadReason] = useState('');
    
    // Classroom requirements state
    const [classroomId, setClassroomId] = useState('');
    const [classroomDate, setClassroomDate] = useState('');
    const [classroomTime, setClassroomTime] = useState('');
    const [classroomReqs, setClassroomReqs] = useState('');
    
    // User role (would come from auth in production)
    const [userRole, setUserRole] = useState('admin');
    const isAdmin = userRole === 'admin';

    const refreshRoads = async () => {
        try {
            const roadsData = await getAvailableRoads();
            setAvailableRoads(roadsData.roads || []);

            const statusData = await getRoadStatus();
            setRoadStatus(statusData.roads || []);
        } catch (err) {
            console.warn('Failed to fetch roads:', err);
        }
    };

    // Fetch available roads and road status
    useEffect(() => {
        refreshRoads();
        const interval = setInterval(refreshRoads, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleRoadControl = async () => {
        if (!selectedRoad) return;
        if (!isAdmin && roadAction !== 'open') {
            alert('Only admin can apply road closures.');
            return;
        }
        try {
            // Find the road name from availableRoads
            const roadInfo = availableRoads.find(r => r.road_id === selectedRoad);
            const roadName = roadInfo?.road_name || selectedRoad;
            
            // Update backend
            await controlRoad(selectedRoad, roadAction, roadReason, roadName, userRole);
            
            // Notify simulator to apply road closure
            if (onSimulatorAction) {
                if (roadAction === 'open') {
                    onSimulatorAction({ type: 'clear_road', road_id: selectedRoad });
                } else {
                    onSimulatorAction({ type: 'road_closure', road_id: selectedRoad, status: roadAction });
                }
            }
            
            await refreshRoads();
            
            setSelectedRoad('');
            setRoadReason('');
        } catch (err) {
            console.error('Failed to control road:', err);
        }
    };

    const handleClearAll = async () => {
        if (!isAdmin) return;

        try {
            const controlledRoads = roadStatus.filter(road => road.road_id);
            await Promise.allSettled(
                controlledRoads.map(road => resetRoad(road.road_id))
            );

            if (onSimulatorAction) {
                controlledRoads.forEach(road => {
                    onSimulatorAction({ type: 'clear_road', road_id: road.road_id });
                });
            }

            setActuationEvents([]);
            setSelectedRoad('');
            setRoadAction('soft_closed');
            setRoadReason('');

            await refreshRoads();
        } catch (err) {
            console.error('Failed to clear all controls:', err);
        }
    };

    const handleAddClassroomReq = async () => {
        if (!classroomId || !classroomDate || !classroomTime) return;
        try {
            await addClassroomRequirement({
                classroom_id: classroomId,
                classroom_name: classroomId,
                date: classroomDate,
                start_time: classroomTime,
                end_time: classroomTime,
                requirements: { notes: classroomReqs },
                faculty_id: userRole
            });
            setClassroomId('');
            setClassroomReqs('');
        } catch (err) {
            console.error('Failed to add requirement:', err);
        }
    };

    const removeEvent = (idx) => {
        setActuationEvents(prev => prev.filter((_, i) => i !== idx));
    };

    return (
        <div style={panelStyle}>
            {/* Control Panel Header */}
            <div style={{
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                borderRadius: '8px',
                padding: '12px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ color: '#c4b5fd', fontSize: '0.8rem', fontWeight: 600 }}>🎛️ CONTROL PANEL</span>
                    <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                        {/* {formatTime(simTime)} */}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {['admin', 'faculty', 'student'].map(role => (
                        <button
                            key={role}
                            onClick={() => setUserRole(role)}
                            style={{
                                flex: 1,
                                padding: '4px 8px',
                                background: userRole === role ? '#8b5cf6' : 'transparent',
                                border: '1px solid #8b5cf6',
                                color: userRole === role ? '#fff' : '#c4b5fd',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                textTransform: 'capitalize'
                            }}
                        >
                            {role}
                        </button>
                    ))}
                </div>
                {isAdmin && (
                    <button
                        onClick={handleClearAll}
                        style={{
                            width: '100%',
                            marginTop: '8px',
                            padding: '6px 8px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            color: '#fca5a5',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.72rem',
                            fontWeight: 700
                        }}
                    >
                        🧹 Clear All (Road Controls + Events)
                    </button>
                )}
            </div>

            {/* Road Control Section */}
            {userRole === 'admin' && (
            <div>
                <button
                    onClick={() => setShowRoadControl(!showRoadControl)}
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
                    <span>🚧 Road Control</span>
                    <span>{showRoadControl ? '▼' : '▶'}</span>
                </button>
                {showRoadControl && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <select
                            value={selectedRoad}
                            onChange={e => setSelectedRoad(e.target.value)}
                            disabled={!isAdmin}
                            style={{
                                padding: '6px 8px',
                                borderRadius: '4px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: 'rgba(0,0,0,0.3)',
                                color: '#fff',
                                fontSize: '0.75rem'
                            }}
                        >
                            <option value="">Select Road...</option>
                            {availableRoads.length > 0 ? (
                                availableRoads.map(road => (
                                    <option key={road.road_id} value={road.road_id}>
                                        {road.road_name} {road.status !== 'open' ? `(${road.status})` : ''}
                                    </option>
                                ))
                            ) : (
                                <>
                                    <option value="main_road_1">Main Road 1</option>
                                    <option value="main_road_2">Main Road 2</option>
                                    <option value="academic_lane">Academic Lane</option>
                                    <option value="hostel_road">Hostel Road</option>
                                    <option value="canteen_path">Canteen Path</option>
                                </>
                            )}
                        </select>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            {[
                                { value: 'open', label: '✅ Open', color: '#10b981' },
                                { value: 'soft_closed', label: '⚠️ Soft Close', color: '#f59e0b' },
                                { value: 'hard_closed', label: '🚫 Hard Close', color: '#ef4444' }
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => setRoadAction(opt.value)}
                                    disabled={!isAdmin || (opt.value === 'hard_closed' && userRole === 'student')}
                                    style={{
                                        flex: 1,
                                        padding: '4px',
                                        background: roadAction === opt.value ? `${opt.color}30` : 'transparent',
                                        border: `1px solid ${opt.color}`,
                                        color: opt.color,
                                        borderRadius: '4px',
                                        cursor: (!isAdmin || (opt.value === 'hard_closed' && userRole === 'student')) ? 'not-allowed' : 'pointer',
                                        fontSize: '0.6rem',
                                        fontWeight: 600,
                                        opacity: (!isAdmin || (opt.value === 'hard_closed' && userRole === 'student')) ? 0.5 : 1
                                    }}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        <input
                            type="text"
                            placeholder="Reason (e.g., Repair work)"
                            value={roadReason}
                            onChange={e => setRoadReason(e.target.value)}
                            disabled={!isAdmin}
                            style={{
                                padding: '6px 8px',
                                borderRadius: '4px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: 'rgba(0,0,0,0.3)',
                                color: '#fff',
                                fontSize: '0.75rem'
                            }}
                        />
                        <button
                            onClick={handleRoadControl}
                            disabled={!selectedRoad || !isAdmin}
                            style={{
                                padding: '8px',
                                background: (selectedRoad && isAdmin) ? '#8b5cf6' : 'rgba(255,255,255,0.1)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: (selectedRoad && isAdmin) ? 'pointer' : 'not-allowed',
                                fontWeight: 'bold',
                                fontSize: '0.75rem'
                            }}
                        >
                            Apply Road Control
                        </button>
                        
                        {/* Current Road Status */}
                        {roadStatus.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                    Active Road Controls:
                                </div>
                                {roadStatus.map((road, i) => (
                                    <div key={i} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '4px 8px',
                                        background: road.status === 'hard_closed' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                                        borderRadius: '4px',
                                        fontSize: '0.65rem',
                                        marginBottom: '4px'
                                    }}>
                                        <span>{road.road_name || road.road_id}</span>
                                        <span style={{ 
                                            color: road.status === 'hard_closed' ? '#ef4444' : '#f59e0b'
                                        }}>
                                            {road.status}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            )}

            {/* Classroom Requirements (Faculty only) */}
            {(userRole === 'faculty' || userRole === 'admin') && (
                <div>
                    <button
                        onClick={() => setShowClassroom(!showClassroom)}
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
                        <span>🏫 Classroom Setup</span>
                        <span>{showClassroom ? '▼' : '▶'}</span>
                    </button>
                    {showClassroom && (
                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <input
                                type="text"
                                placeholder="Classroom ID (e.g., A101)"
                                value={classroomId}
                                onChange={e => setClassroomId(e.target.value)}
                                style={{
                                    padding: '6px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.75rem'
                                }}
                            />
                            <input
                                type="date"
                                value={classroomDate}
                                onChange={e => setClassroomDate(e.target.value)}
                                style={{
                                    padding: '6px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.75rem'
                                }}
                            />
                            <input
                                type="time"
                                value={classroomTime}
                                onChange={e => setClassroomTime(e.target.value)}
                                style={{
                                    padding: '6px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.75rem'
                                }}
                            />
                            <textarea
                                placeholder="Requirements (e.g., Projector, AC on, Lights dim)"
                                value={classroomReqs}
                                onChange={e => setClassroomReqs(e.target.value)}
                                style={{
                                    padding: '6px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.75rem',
                                    minHeight: '60px',
                                    resize: 'vertical'
                                }}
                            />
                            <button
                                onClick={handleAddClassroomReq}
                                style={{
                                    padding: '8px',
                                    background: '#3b82f6',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '0.75rem'
                                }}
                            >
                                📤 Submit Classroom Setup
                            </button>
                        </div>
                    )}
                </div>
            )}

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
// SIMULATE MODE - Sandbox Experiment Panel
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
    categoryOccupancy,
    onSimulatorAction
}) {
    const [showSchedule, setShowSchedule] = useState(true);
    const [showRoadConfig, setShowRoadConfig] = useState(false);
    const [showEvaluation, setShowEvaluation] = useState(false);
    const [isSimulationActive, setIsSimulationActive] = useState(false);
    
    // Schedule builder state
    const [scheduleEntries, setScheduleEntries] = useState([]);
    const [entryTime, setEntryTime] = useState('08:00');
    const [entryFrom, setEntryFrom] = useState('');
    const [entryTo, setEntryTo] = useState('');
    const [entryCohort, setEntryCohort] = useState('ug1');
    const [entryCount, setEntryCount] = useState(100);
    
    // Road closure config for simulation
    const [simRoadClosures, setSimRoadClosures] = useState([]);
    const [simRoad, setSimRoad] = useState('');
    const [simRoadStatus, setSimRoadStatus] = useState('soft_closed');
    const [availableRoads, setAvailableRoads] = useState([]);
    
    // Evaluation results
    const [evalResults, setEvalResults] = useState(null);
    const [evalLoading, setEvalLoading] = useState(false);

    const SPEED_OPTIONS = [
        { label: '1×', value: 1 },
        { label: '5×', value: 5 },
        { label: '15×', value: 15 },
        { label: '60×', value: 60 },
    ];

    const COHORT_OPTIONS = [
        { id: 'ug1', name: 'UG1 Students' },
        { id: 'ug2', name: 'UG2 Students' },
        { id: 'ug3', name: 'UG3 Students' },
        { id: 'ug4', name: 'UG4 Students' },
        { id: 'faculty', name: 'Faculty' },
        { id: 'staff', name: 'Staff' },
    ];

    const LOCATION_OPTIONS = [
        'Hostels', 'Academic Block A', 'Academic Block B', 'Library',
        'Canteen', 'Sports Complex', 'Admin Block', 'Main Gate', 'Side Gate'
    ];

    useEffect(() => {
        const fetchRoads = async () => {
            try {
                const roadsData = await getAvailableRoads();
                setAvailableRoads(roadsData.roads || []);
            } catch (err) {
                console.warn('Failed to fetch simulation roads:', err);
            }
        };

        fetchRoads();
        const interval = setInterval(fetchRoads, 5000);
        return () => clearInterval(interval);
    }, []);

    const addScheduleEntry = () => {
        if (!entryFrom || !entryTo) return;
        setScheduleEntries(prev => [...prev, {
            id: Date.now(),
            time: entryTime,
            from: entryFrom,
            to: entryTo,
            cohort: entryCohort,
            count: entryCount
        }]);
        setEntryCount(100);
    };

    const removeScheduleEntry = (id) => {
        setScheduleEntries(prev => prev.filter(e => e.id !== id));
    };

    const addRoadClosure = () => {
        if (!simRoad) return;
        const roadMeta = availableRoads.find(r => r.road_id === simRoad);
        setSimRoadClosures(prev => [...prev, {
            id: Date.now(),
            road_id: simRoad,
            road_name: roadMeta?.road_name || simRoad,
            status: simRoadStatus
        }]);
        setSimRoad('');
    };

    const removeRoadClosure = (id) => {
        setSimRoadClosures(prev => prev.filter(r => r.id !== id));
    };

    const startSimulation = () => {
        if (scheduleEntries.length === 0) {
            alert('Please add at least one schedule entry');
            return;
        }
        
        setIsSimulationActive(true);
        setIsRunning(true);
        
        // Notify simulator to start custom simulation
        if (onSimulatorAction) {
            onSimulatorAction({
                type: 'start_simulation',
                schedule: scheduleEntries,
                roadClosures: simRoadClosures,
                initialPopulation: scheduleEntries.reduce((sum, e) => sum + e.count, 0)
            });
        }
    };

    const stopSimulation = () => {
        setIsSimulationActive(false);
        setIsRunning(false);
        
        if (onSimulatorAction) {
            onSimulatorAction({ type: 'stop_simulation' });
        }
    };

    const handleClearAllSimulation = () => {
        stopSimulation();
        setScheduleEntries([]);
        setSimRoadClosures([]);
        setEvalResults(null);
        setEvalLoading(false);
        setEntryTime('08:00');
        setEntryFrom('');
        setEntryTo('');
        setEntryCohort('ug1');
        setEntryCount(100);
        setSimRoad('');
        setSimRoadStatus('soft_closed');
        setSimTime(8);
    };

    const runEvaluation = async () => {
        setEvalLoading(true);
        try {
            const config = {
                name: `Experiment_${Date.now()}`,
                schedule: scheduleEntries.map(e => ({
                    time: e.time,
                    from_location: e.from,
                    to_location: e.to,
                    cohort: e.cohort,
                    count: e.count
                })),
                road_closures: simRoadClosures.map(r => ({
                    road_id: r.road_id,
                    road_name: r.road_name,
                    status: r.status
                })),
                initial_population: scheduleEntries.reduce((sum, e) => sum + e.count, 0),
                actuation_rules_enabled: true
            };
            
            const results = await evaluateSimulation(config);
            setEvalResults(results);
        } catch (err) {
            console.error('Evaluation failed:', err);
            setEvalResults({
                feasible: false,
                issues: [{ type: 'error', severity: 'critical', message: 'Evaluation failed - backend not available' }],
                auto_fixes: []
            });
        } finally {
            setEvalLoading(false);
        }
    };

    const totalPeople = scheduleEntries.reduce((sum, e) => sum + e.count, 0);

    return (
        <div style={panelStyle}>
            {/* Sandbox Header */}
            <div style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15))',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '8px',
                padding: '12px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div>
                        <span style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>🧪 SANDBOX MODE</span>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            Experiment with crowd scenarios
                        </div>
                    </div>
                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                        {formatTime(simTime)}
                    </span>
                </div>
                
                {/* Time Controls */}
                <input
                    type="range"
                    min="0"
                    max="23.99"
                    step="0.0833"
                    value={simTime}
                    onChange={(e) => setSimTime(parseFloat(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer', accentColor: '#10b981' }}
                />
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                    <button
                        onClick={() => isSimulationActive ? stopSimulation() : startSimulation()}
                        style={{
                            flex: 1,
                            padding: '6px 12px',
                            background: isSimulationActive ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)',
                            border: `1px solid ${isSimulationActive ? '#ef4444' : '#10b981'}`,
                            color: isSimulationActive ? '#ef4444' : '#10b981',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontSize: '0.75rem'
                        }}
                    >
                        {isSimulationActive ? '⏹ Stop' : '▶ Run Simulation'}
                    </button>
                    <div style={{ display: 'flex', gap: '2px' }}>
                        {SPEED_OPTIONS.map(opt => (
                            <button
                                key={opt.label}
                                onClick={() => { setSpeed(opt.value); }}
                                style={{
                                    padding: '5px 8px',
                                    background: speed === opt.value ? '#10b981' : 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    color: speed === opt.value ? 'white' : 'var(--text-secondary)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.65rem'
                                }}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    onClick={handleClearAllSimulation}
                    style={{
                        width: '100%',
                        marginTop: '8px',
                        padding: '6px 8px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        color: '#fca5a5',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.72rem',
                        fontWeight: 700
                    }}
                >
                    🧹 Clear All Sandbox
                </button>
            </div>

            {/* Schedule Builder */}
            <div>
                <button
                    onClick={() => setShowSchedule(!showSchedule)}
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
                    <span>📋 Schedule Builder ({scheduleEntries.length} entries, {totalPeople} people)</span>
                    <span>{showSchedule ? '▼' : '▶'}</span>
                </button>
                {showSchedule && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {/* Entry Form */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                            <input
                                type="time"
                                value={entryTime}
                                onChange={e => setEntryTime(e.target.value)}
                                style={{
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.7rem'
                                }}
                            />
                            <select
                                value={entryCohort}
                                onChange={e => setEntryCohort(e.target.value)}
                                style={{
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.7rem'
                                }}
                            >
                                {COHORT_OPTIONS.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                            <select
                                value={entryFrom}
                                onChange={e => setEntryFrom(e.target.value)}
                                style={{
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.7rem'
                                }}
                            >
                                <option value="">From...</option>
                                {LOCATION_OPTIONS.map(loc => (
                                    <option key={loc} value={loc}>{loc}</option>
                                ))}
                            </select>
                            <select
                                value={entryTo}
                                onChange={e => setEntryTo(e.target.value)}
                                style={{
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.7rem'
                                }}
                            >
                                <option value="">To...</option>
                                {LOCATION_OPTIONS.map(loc => (
                                    <option key={loc} value={loc}>{loc}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <input
                                type="number"
                                placeholder="Count"
                                value={entryCount}
                                onChange={e => setEntryCount(parseInt(e.target.value) || 0)}
                                style={{
                                    flex: 1,
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.7rem'
                                }}
                            />
                            <button
                                onClick={addScheduleEntry}
                                style={{
                                    padding: '4px 12px',
                                    background: '#3b82f6',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '0.7rem'
                                }}
                            >
                                + Add
                            </button>
                        </div>
                        
                        {/* Schedule Entries List */}
                        {scheduleEntries.length > 0 && (
                            <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                                {scheduleEntries.map(entry => (
                                    <div key={entry.id} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '4px 8px',
                                        background: 'rgba(59, 130, 246, 0.1)',
                                        borderRadius: '4px',
                                        fontSize: '0.65rem',
                                        marginBottom: '4px'
                                    }}>
                                        <span>{entry.time} | {entry.count} {entry.cohort} | {entry.from} → {entry.to}</span>
                                        <button
                                            onClick={() => removeScheduleEntry(entry.id)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: '#ef4444',
                                                cursor: 'pointer',
                                                fontSize: '0.7rem'
                                            }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Road Configuration for Experiment */}
            <div>
                <button
                    onClick={() => setShowRoadConfig(!showRoadConfig)}
                    style={{
                        width: '100%',
                        background: 'rgba(245, 158, 11, 0.08)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        padding: '8px 10px',
                        borderRadius: '5px',
                        color: '#fbbf24',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                    }}
                >
                    <span>🚧 Road Configuration ({simRoadClosures.length})</span>
                    <span>{showRoadConfig ? '▼' : '▶'}</span>
                </button>
                {showRoadConfig && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{
                            padding: '6px 8px',
                            background: 'rgba(245, 158, 11, 0.1)',
                            borderRadius: '4px',
                            fontSize: '0.65rem',
                            color: 'var(--text-secondary)'
                        }}>
                            💡 <strong>Soft Close:</strong> System can auto-open if too crowded. <br/>
                            🚫 <strong>Hard Close:</strong> Road stays closed (repair work etc).
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <select
                                value={simRoad}
                                onChange={e => setSimRoad(e.target.value)}
                                style={{
                                    flex: 1,
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.7rem'
                                }}
                            >
                                <option value="">Select Road...</option>
                                {availableRoads.map(road => (
                                    <option key={road.road_id} value={road.road_id}>
                                        {road.road_name}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={simRoadStatus}
                                onChange={e => setSimRoadStatus(e.target.value)}
                                style={{
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    background: 'rgba(0,0,0,0.3)',
                                    color: '#fff',
                                    fontSize: '0.7rem'
                                }}
                            >
                                <option value="soft_closed">Soft Close</option>
                                <option value="hard_closed">Hard Close</option>
                            </select>
                            <button
                                onClick={addRoadClosure}
                                style={{
                                    padding: '4px 10px',
                                    background: '#f59e0b',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    fontSize: '0.7rem'
                                }}
                            >
                                +
                            </button>
                        </div>
                        
                        {simRoadClosures.map(road => (
                            <div key={road.id} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '4px 8px',
                                background: road.status === 'hard_closed' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                                borderRadius: '4px',
                                fontSize: '0.65rem'
                            }}>
                                <span>{road.road_name} - {road.status === 'hard_closed' ? '🚫 Hard' : '⚠️ Soft'}</span>
                                <button
                                    onClick={() => removeRoadClosure(road.id)}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: '#ef4444',
                                        cursor: 'pointer',
                                        fontSize: '0.7rem'
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Evaluation */}
            <div>
                <button
                    onClick={() => setShowEvaluation(!showEvaluation)}
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
                    <span>📊 Evaluate Scenario</span>
                    <span>{showEvaluation ? '▼' : '▶'}</span>
                </button>
                {showEvaluation && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <button
                            onClick={runEvaluation}
                            disabled={evalLoading || scheduleEntries.length === 0}
                            style={{
                                padding: '8px',
                                background: scheduleEntries.length === 0 ? 'rgba(255,255,255,0.1)' : '#8b5cf6',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: scheduleEntries.length === 0 ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                                fontSize: '0.75rem'
                            }}
                        >
                            {evalLoading ? '⏳ Analyzing...' : '🔍 Run Analysis'}
                        </button>
                        
                        {evalResults && (
                            <div style={{
                                background: evalResults.feasible ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                border: `1px solid ${evalResults.feasible ? '#10b981' : '#ef4444'}`,
                                borderRadius: '6px',
                                padding: '10px'
                            }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    marginBottom: '8px',
                                    fontSize: '0.8rem',
                                    fontWeight: 700,
                                    color: evalResults.feasible ? '#10b981' : '#ef4444'
                                }}>
                                    {evalResults.feasible ? '✅ Scenario Feasible' : '❌ Issues Found'}
                                </div>
                                
                                {evalResults.issues?.length > 0 && (
                                    <div style={{ fontSize: '0.7rem' }}>
                                        {evalResults.issues.map((issue, i) => (
                                            <div key={i} style={{
                                                padding: '4px 6px',
                                                background: SEVERITY_BG[issue.severity] || 'rgba(255,255,255,0.05)',
                                                borderLeft: `3px solid ${SEVERITY_COLORS[issue.severity] || '#9ca3af'}`,
                                                borderRadius: '3px',
                                                marginBottom: '4px'
                                            }}>
                                                <div style={{ color: SEVERITY_COLORS[issue.severity], fontWeight: 600 }}>{issue.type}</div>
                                                <div style={{ color: 'var(--text-secondary)' }}>{issue.message}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                {evalResults.auto_fixes?.length > 0 && (
                                    <div style={{ marginTop: '8px' }}>
                                        <div style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600, marginBottom: '4px' }}>
                                            🔧 Auto-Fixes Applied:
                                        </div>
                                        {evalResults.auto_fixes.map((fix, i) => (
                                            <div key={i} style={{
                                                fontSize: '0.65rem',
                                                color: 'var(--text-secondary)',
                                                padding: '2px 0'
                                            }}>
                                                • {fix.action}: {fix.road_id} - {fix.reason}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Info Note */}
            <div style={{
                padding: '10px',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '6px',
                fontSize: '0.65rem',
                color: 'var(--text-secondary)'
            }}>
                💡 <strong>Tip:</strong> Start with an empty map, add your schedule entries, configure road closures, and run the simulation to see how the campus handles your scenario. The system will automatically open soft-closed roads if crowd exceeds thresholds.
            </div>
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
    liveCategoryOccupancy,
    onSimulatorAction,
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
    const [simulationSessionId, setSimulationSessionId] = useState(0);
    const prevModeRef = useRef(mode);

    useEffect(() => {
        if (prevModeRef.current !== 'simulate' && mode === 'simulate') {
            setSimulationSessionId(Date.now());
        }
        prevModeRef.current = mode;
    }, [mode]);

    // Auto-fetch congestion data when simTime changes
    useEffect(() => {
        const loadCongestion = async () => {
            try {
                const data = await fetchCongestion(simTime);
                setCongestionAlerts(data.alerts || []);
                // Only use backend occupancy if no live data from simulator
                if (!liveCategoryOccupancy || Object.keys(liveCategoryOccupancy).length === 0) {
                    setCategoryOccupancy(data.category_occupancy || {});
                }
            } catch (err) {
                // Backend might not be running
            }
        };
        loadCongestion();
    }, [Math.floor(simTime)]);

    // Prefer live occupancy from simulator when available
    const effectiveOccupancy = (liveCategoryOccupancy && Object.keys(liveCategoryOccupancy).length > 0)
        ? liveCategoryOccupancy
        : categoryOccupancy;

    // Header content based on mode
    const getModeHeader = () => {
        switch (mode) {
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
                    categoryOccupancy={effectiveOccupancy}
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
                    onSimulatorAction={onSimulatorAction}
                />
            );
        }

        if (mode === 'simulate') {
            return (
                <SimulatePanel
                    key={simulationSessionId}
                    simTime={simTime}
                    setSimTime={setSimTime}
                    isRunning={isRunning}
                    setIsRunning={setIsRunning}
                    speed={speed}
                    setSpeed={setSpeed}
                    formatTime={formatTime}
                    availableBuildings={availableBuildings}
                    congestionAlerts={congestionAlerts}
                    categoryOccupancy={effectiveOccupancy}
                    onSimulatorAction={onSimulatorAction}
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
