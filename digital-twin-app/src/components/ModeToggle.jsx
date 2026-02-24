import { useState } from 'react';
import { Layers, Zap, Activity } from 'lucide-react';

export default function ModeToggle({ currentMode, setMode }) {
  const modes = [
    { id: 'visualize', label: 'Visualize', icon: <Layers size={18} /> },
    { id: 'actuate', label: 'Actuate', icon: <Zap size={18} /> },
    { id: 'simulate', label: 'Simulate', icon: <Activity size={18} /> },
  ];

  return (
    <div className="glass-panel" style={{
      position: 'absolute',
      top: '20px',
      right: '20px',
      display: 'flex',
      gap: '8px',
      padding: '8px',
      zIndex: 100
    }}>
      {modes.map(mode => (
        <button
          key={mode.id}
          onClick={() => setMode(mode.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            borderRadius: '10px',
            border: 'none',
            background: currentMode === mode.id ? 'var(--accent-blue)' : 'transparent',
            color: currentMode === mode.id ? '#fff' : 'var(--text-secondary)',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          {mode.icon}
          {mode.label}
        </button>
      ))}
    </div>
  );
}
