import { useState, useEffect, useRef } from 'react';
import ModeToggle from './components/ModeToggle';
import MapContainer from './components/MapContainer';
import BuildingPanel from './components/BuildingPanel';
import DecisionPanel from './components/DecisionPanel';
import CSVUploadPanel from './components/CSVUploadPanel';
import { useSchedule } from './hooks/useSchedule';

// How fast time runs:  1 real second = N simulated minutes
const SIM_SPEED_MINUTES_PER_SECOND = 1; // 1s real = 1 min sim by default

function App() {
  const [currentMode, setMode] = useState('visualize');
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [availableBuildings, setAvailableBuildings] = useState([]);

  // Load schedule from backend on mount
  useSchedule();

  const [simTime, setSimTime] = useState(7.75);
  const [isRunning, setIsRunning] = useState(true);
  const [speed, setSpeed] = useState(SIM_SPEED_MINUTES_PER_SECOND);
  const intervalRef = useRef(null);

  // Auto-running clock
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!isRunning) return;

    intervalRef.current = setInterval(() => {
      setSimTime(prev => {
        const next = prev + speed / 60; // speed minutes / 60 = fractional hours
        return next >= 24 ? 0 : next;   // Loop midnight
      });
    }, 1000); // tick every real second

    return () => clearInterval(intervalRef.current);
  }, [isRunning, speed]);

  const formatTime = (decimalHours) => {
    const hrs = Math.floor(decimalHours) % 24;
    const mins = Math.floor((decimalHours - Math.floor(decimalHours)) * 60);
    const suffix = hrs >= 12 ? 'PM' : 'AM';
    const displayHrs = hrs % 12 === 0 ? 12 : hrs % 12;
    return `${displayHrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${suffix}`;
  };

  const SPEED_OPTIONS = [
    { label: '1×', value: 1 },
    { label: '5×', value: 5 },
    { label: '15×', value: 15 },
    { label: '60×', value: 60 },
  ];

  return (
    <>
      <MapContainer
        currentMode={currentMode}
        onBuildingSelect={setSelectedBuilding}
        onBuildingsLoaded={setAvailableBuildings}
        simTime={simTime}
      />

      <div className="ui-layer">
        <ModeToggle currentMode={currentMode} setMode={setMode} />

        <CSVUploadPanel />

        {/* Virtual Clock Panel */}
        {currentMode === 'visualize' && (
        <div className="glass-panel" style={{
          position: 'absolute',
          top: '80px',
          right: '20px',
          padding: '12px 16px',
          width: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          alignItems: 'center',
          zIndex: 100
        }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>
            🕐 Time
          </span>
          <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(simTime)}
          </span>
        </div>
        )}

        {/* Virtual Clock Panel - Full controls for Simulate mode */}
        {currentMode === 'simulate' && (
        <div className="glass-panel" style={{
          position: 'absolute',
          top: '80px',
          right: '20px',
          padding: '16px',
          width: '300px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          zIndex: 100
        }}>
          {/* Time display */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
              🕐 Virtual Time
            </span>
            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
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
            onChange={(e) => { setSimTime(parseFloat(e.target.value)); }}
            style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--accent-blue)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '-6px' }}>
            <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span>
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Play/Pause */}
            <button
              onClick={() => setIsRunning(r => !r)}
              style={{
                padding: '6px 14px',
                background: isRunning ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)',
                border: `1px solid ${isRunning ? '#ef4444' : '#10b981'}`,
                color: isRunning ? '#ef4444' : '#10b981',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.85rem',
                minWidth: '70px'
              }}
            >
              {isRunning ? '⏸ Pause' : '▶ Play'}
            </button>

            {/* Speed buttons */}
            <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
              {SPEED_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => { setSpeed(opt.value); setIsRunning(true); }}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    background: speed === opt.value && isRunning ? 'var(--accent-blue)' : 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: speed === opt.value && isRunning ? 'white' : 'var(--text-secondary)',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.75rem'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        )}

        {selectedBuilding && (
          <BuildingPanel
            building={selectedBuilding}
            mode={currentMode}
            simTime={simTime}
          />
        )}

        {(currentMode === 'actuate' || currentMode === 'simulate') && (
          <DecisionPanel availableBuildings={availableBuildings} simTime={simTime} />
        )}
      </div>
    </>
  );
}

export default App;
