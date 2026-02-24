import { SimulationDB } from '../engine/SimulationDB';

export default function BuildingPanel({ building, mode, simTime }) {
    if (!building) return null;

    const category = building.properties?.category || SimulationDB.classifyBuilding(building.name);
    const currentHour = Math.floor(simTime || 7.75);

    // Find all cohorts whose target category matches this building
    const activeCohorts = SimulationDB.agents.filter(agent => {
        return SimulationDB.getTargetCategory(agent.profile, currentHour) === category;
    });

    return (
        <div className="glass-panel" style={{
            position: 'absolute',
            top: '80px',
            left: '20px',
            width: '320px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            zIndex: 100,
            animation: 'slideIn 0.3s ease-out'
        }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                {building.name || 'Unknown Building'}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Occupancy</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent-green)' }}>
                        {Math.floor(Math.random() * 80) + 10}%
                    </div>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Status</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-green)', marginTop: '4px' }}>
                        Normal
                    </div>
                </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '8px', marginTop: 0 }}>Active Schedules</h3>
                {activeCohorts.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {activeCohorts.map((c, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                <div style={{
                                    width: '12px', height: '12px',
                                    backgroundColor: '#' + c.color.toString(16).padStart(6, '0'),
                                    borderRadius: '50%',
                                    marginRight: '8px'
                                }}></div>
                                {c.profile}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No cohorts currently scheduled.</div>
                )}
            </div>

            <div>
                <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Configuration Plan</h3>
                <div style={{
                    height: '150px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-secondary)',
                    border: '1px dashed rgba(255,255,255,0.2)'
                }}>
                    Floor Plan View
                </div>
            </div>

            {mode === 'actuate' && (
                <button style={{
                    padding: '12px',
                    background: 'var(--accent-blue)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600'
                }}>
                    Manage Configuration
                </button>
            )}
        </div>
    );
}
