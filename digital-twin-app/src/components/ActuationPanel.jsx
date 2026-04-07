import { useState, useEffect } from 'react';

const PRIORITY_COLORS = {
    p0: '#ef4444',
    p1: '#f59e0b',
    p2: '#3b82f6',
};

const PRIORITY_BG = {
    p0: 'rgba(239, 68, 68, 0.1)',
    p1: 'rgba(245, 158, 11, 0.1)',
    p2: 'rgba(59, 130, 246, 0.1)',
};

const PRIORITY_LABELS = {
    p0: 'Critical',
    p1: 'High',
    p2: 'Medium',
};

export default function ActuationPanel({ simTime, events }) {
    const [actuationPlan, setActuationPlan] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showDecisions, setShowDecisions] = useState(true);
    const [showContext, setShowContext] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    
    // Configurable actuation parameters
    const [maxActions, setMaxActions] = useState(3);
    const [objective, setObjective] = useState('minimize_congestion');
    const [approvalMode, setApprovalMode] = useState('manual');

    // Auto-fetch actuation plan when simTime changes
    useEffect(() => {
        const loadActuationPlan = async () => {
            setLoading(true);
            try {
                const response = await fetch('http://localhost:8000/actuation-plan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sim_time: simTime,
                        events: events || [],
                        objective: objective,
                        max_actions: maxActions,
                        approval_mode: approvalMode
                    })
                });
                const data = await response.json();
                setActuationPlan(data);
            } catch (err) {
                console.error('Error loading actuation plan:', err);
            } finally {
                setLoading(false);
            }
        };
        loadActuationPlan();
    }, [Math.floor(simTime), maxActions, objective, approvalMode]); // Re-fetch when settings change

    const decisions = actuationPlan?.decisions || [];
    const alerts = actuationPlan?.alerts || [];
    const agentState = actuationPlan?.agent_state || {};

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
                gap: '6px',
                justifyContent: 'space-between'
            }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '1.1rem' }}>⚡</span> AI Actuation
                </span>
                {loading && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>⏳</span>}
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
                    <span>⚙️ Actuation Settings</span>
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
                        gap: '12px'
                    }}>
                        {/* Max Actions */}
                        <div>
                            <label style={{
                                display: 'block',
                                fontSize: '0.7rem',
                                color: 'var(--text-secondary)',
                                marginBottom: '4px',
                                fontWeight: 600
                            }}>
                                Max Actions: {maxActions}
                            </label>
                            <input
                                type="range"
                                min="1"
                                max="10"
                                step="1"
                                value={maxActions}
                                onChange={(e) => setMaxActions(parseInt(e.target.value))}
                                style={{
                                    width: '100%',
                                    cursor: 'pointer',
                                    accentColor: 'var(--accent-blue)'
                                }}
                            />
                        </div>

                        {/* Objective */}
                        <div>
                            <label style={{
                                display: 'block',
                                fontSize: '0.7rem',
                                color: 'var(--text-secondary)',
                                marginBottom: '4px',
                                fontWeight: 600
                            }}>
                                Objective
                            </label>
                            <select
                                value={objective}
                                onChange={(e) => setObjective(e.target.value)}
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
                                <option value="minimize_congestion">Minimize Congestion</option>
                                <option value="optimize_flow">Optimize Flow</option>
                                <option value="emergency_response">Emergency Response</option>
                                <option value="energy_efficiency">Energy Efficiency</option>
                            </select>
                        </div>

                        {/* Approval Mode */}
                        <div>
                            <label style={{
                                display: 'block',
                                fontSize: '0.7rem',
                                color: 'var(--text-secondary)',
                                marginBottom: '4px',
                                fontWeight: 600
                            }}>
                                Approval Mode
                            </label>
                            <select
                                value={approvalMode}
                                onChange={(e) => setApprovalMode(e.target.value)}
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
                                <option value="manual">Manual Approval</option>
                                <option value="auto">Auto Execute</option>
                            </select>
                        </div>

                        <button
                            onClick={() => {
                                // Force refresh
                                const loadActuationPlan = async () => {
                                    setLoading(true);
                                    try {
                                        const response = await fetch('http://localhost:8000/actuation-plan', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                sim_time: simTime,
                                                events: events || [],
                                                objective: objective,
                                                max_actions: maxActions,
                                                approval_mode: approvalMode
                                            })
                                        });
                                        const data = await response.json();
                                        setActuationPlan(data);
                                    } catch (err) {
                                        console.error('Error loading actuation plan:', err);
                                    } finally {
                                        setLoading(false);
                                    }
                                };
                                loadActuationPlan();
                            }}
                            style={{
                                padding: '8px',
                                background: 'var(--accent-blue)',
                                border: 'none',
                                borderRadius: '5px',
                                color: 'white',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'opacity 0.2s'
                            }}
                            onMouseOver={(e) => e.target.style.opacity = '0.8'}
                            onMouseOut={(e) => e.target.style.opacity = '1'}
                        >
                            🔄 Refresh Plan
                        </button>
                    </div>
                )}
            </div>

            {/* Agent Status */}
            {agentState.status && (
                <div style={{
                    padding: '8px 10px',
                    background: agentState.status.includes('no_action') 
                        ? 'rgba(16, 185, 129, 0.08)' 
                        : 'rgba(59, 130, 246, 0.08)',
                    border: `1px solid ${agentState.status.includes('no_action') 
                        ? 'rgba(16, 185, 129, 0.3)' 
                        : 'rgba(59, 130, 246, 0.3)'}`,
                    borderRadius: '5px',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                        Agent Status: <span style={{ 
                            color: agentState.status.includes('no_action') ? '#6ee7b7' : '#93c5fd' 
                        }}>
                            {agentState.status}
                        </span>
                    </div>
                    <div>{agentState.reason}</div>
                    {actuationPlan?.decision_source && (
                        <div style={{ marginTop: '4px', fontSize: '0.65rem' }}>
                            Source: <span style={{ fontWeight: 600 }}>{actuationPlan.decision_source}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Recommended Actions */}
            {decisions.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowDecisions(!showDecisions)}
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
                        <span>🎯 Recommended Actions ({decisions.length})</span>
                        <span>{showDecisions ? '▼' : '▶'}</span>
                    </button>
                    {showDecisions && (
                        <div style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '8px', 
                            marginTop: '8px' 
                        }}>
                            {decisions.map((decision, i) => (
                                <div key={i} style={{
                                    background: PRIORITY_BG[decision.priority] || PRIORITY_BG.p2,
                                    border: `1px solid ${PRIORITY_COLORS[decision.priority] || PRIORITY_COLORS.p2}40`,
                                    borderLeft: `3px solid ${PRIORITY_COLORS[decision.priority] || PRIORITY_COLORS.p2}`,
                                    padding: '10px',
                                    borderRadius: '4px',
                                    fontSize: '0.7rem',
                                }}>
                                    <div style={{ 
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '6px'
                                    }}>
                                        <div style={{ 
                                            fontWeight: 700, 
                                            color: PRIORITY_COLORS[decision.priority] || PRIORITY_COLORS.p2
                                        }}>
                                            {decision.target}
                                        </div>
                                        <div style={{
                                            fontSize: '0.65rem',
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            background: PRIORITY_COLORS[decision.priority] || PRIORITY_COLORS.p2,
                                            color: 'white',
                                            fontWeight: 600
                                        }}>
                                            {PRIORITY_LABELS[decision.priority] || decision.priority}
                                        </div>
                                    </div>
                                    <div style={{ 
                                        color: 'var(--text-primary)', 
                                        lineHeight: '1.4',
                                        marginBottom: '6px'
                                    }}>
                                        {decision.action}
                                    </div>
                                    {decision.rationale && (
                                        <div style={{ 
                                            color: 'var(--text-secondary)', 
                                            fontSize: '0.65rem',
                                            lineHeight: '1.3',
                                            fontStyle: 'italic',
                                            marginBottom: '4px'
                                        }}>
                                            💡 {decision.rationale}
                                        </div>
                                    )}
                                    <div style={{ 
                                        color: 'var(--text-secondary)', 
                                        fontSize: '0.65rem' 
                                    }}>
                                        ⏱️ ETA: {decision.eta_minutes} minutes
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Context: Alerts Detected */}
            {alerts.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowContext(!showContext)}
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
                        <span>🔍 Context: Alerts ({alerts.length})</span>
                        <span>{showContext ? '▼' : '▶'}</span>
                    </button>
                    {showContext && (
                        <div style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '4px', 
                            marginTop: '8px' 
                        }}>
                            {alerts.map((alert, i) => (
                                <div key={i} style={{
                                    padding: '6px 8px',
                                    background: 'rgba(239, 68, 68, 0.05)',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    borderRadius: '3px',
                                    fontSize: '0.65rem',
                                    color: 'var(--text-secondary)'
                                }}>
                                    <div style={{ fontWeight: 600, color: '#fca5a5' }}>
                                        {alert.location} ({alert.severity})
                                    </div>
                                    <div>{alert.recommendation}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Occupancy if available */}
            {actuationPlan?.category_occupancy && Object.keys(actuationPlan.category_occupancy).length > 0 && (
                <div style={{ 
                    fontSize: '0.7rem', 
                    color: 'var(--text-secondary)',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255,255,255,0.1)'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>Current Occupancy:</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                        {Object.entries(actuationPlan.category_occupancy).map(([cat, count]) => (
                            <div key={cat} style={{ 
                                padding: '4px 6px',
                                background: 'rgba(255,255,255,0.03)',
                                borderRadius: '3px'
                            }}>
                                <span style={{ textTransform: 'capitalize' }}>{cat}:</span> <strong>{count}</strong>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
