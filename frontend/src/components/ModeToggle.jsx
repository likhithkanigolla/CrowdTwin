import { Layers, Zap, Activity } from 'lucide-react';

export default function ModeToggle({
  currentMode,
  setMode,
  mapLat,
  mapLng,
  setMapLat,
  setMapLng,
  mapLoading,
  onTeleport,
}) {
  const modes = [
    { id: 'visualize', label: 'Visualize', icon: <Layers size={18} /> },
    { id: 'actuate', label: 'Actuate', icon: <Zap size={18} /> },
    { id: 'simulate', label: 'Simulate', icon: <Activity size={18} /> },
  ];

  const modeSubtitle =
    currentMode === 'simulate'
      ? 'Sandbox simulation'
      : currentMode === 'actuate'
        ? 'Control and automation'
        : 'Live campus visualization';

  return (
    <div style={{
      position: 'absolute',
      top: '0',
      left: '0',
      right: '0',
      zIndex: 100,
      padding: '12px',
      pointerEvents: 'none'
    }}>
      <div className="ct-panel" style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        width: '100%',
        minHeight: '52px',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: '8px',
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
            boxShadow: '0 12px 24px rgba(2, 6, 23, 0.3)'
          }}>
            <Activity size={16} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{
              fontSize: '0.88rem',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: 'hsl(var(--foreground))',
              whiteSpace: 'nowrap'
            }}>
              CrowdTwin
            </div>
            <div style={{
              fontSize: '0.62rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'hsl(var(--muted-foreground))',
              minWidth: '180px',
              whiteSpace: 'nowrap'
            }}>
              {modeSubtitle}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          border: '1px solid hsl(var(--border) / 0.75)',
          borderRadius: '10px',
          background: 'hsl(var(--background) / 0.45)',
          padding: '3px'
        }}>
          {modes.map(mode => (
            <button
              key={mode.id}
              onClick={() => setMode(mode.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                justifyContent: 'center',
                minWidth: '100px',
                height: '32px',
                padding: '0 11px',
                borderRadius: '8px',
                border: 'none',
                background: currentMode === mode.id ? 'hsl(var(--primary))' : 'transparent',
                color: currentMode === mode.id ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                fontWeight: 600,
                fontSize: '0.78rem',
                cursor: 'pointer',
                transition: 'background-color 0.22s ease, color 0.22s ease, box-shadow 0.22s ease'
              }}
            >
              {mode.icon}
              {mode.label}
            </button>
          ))}
        </div>

        <div style={{
          width: '1px',
          height: '26px',
          background: 'hsl(var(--border) / 0.8)'
        }} />

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginLeft: 'auto',
          whiteSpace: 'nowrap'
        }}>
          <span style={{
            fontSize: '0.65rem',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'hsl(var(--muted-foreground))',
            fontWeight: 700
          }}>
            Coordinates
          </span>

          <span className="ct-chip" style={{
            visibility: mapLoading ? 'visible' : 'hidden',
            minWidth: '70px',
            justifyContent: 'center',
            fontSize: '0.62rem',
            padding: '2px 8px',
            color: '#facc15',
            borderColor: 'rgba(250, 204, 21, 0.35)'
          }}>
            Loading...
          </span>

          <input
            type="number"
            step="0.000001"
            value={mapLat}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) setMapLat(next);
            }}
            placeholder="LAT"
            style={{
              width: '108px',
              height: '32px',
              padding: '6px 8px',
              borderRadius: '8px',
              border: '1px solid hsl(var(--border) / 0.8)',
              background: 'hsl(var(--background) / 0.45)',
              color: 'hsl(var(--foreground))',
              fontSize: '0.73rem',
              fontWeight: 500,
              outline: 'none'
            }}
          />

          <input
            type="number"
            step="0.000001"
            value={mapLng}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) setMapLng(next);
            }}
            placeholder="LNG"
            style={{
              width: '108px',
              height: '32px',
              padding: '6px 8px',
              borderRadius: '8px',
              border: '1px solid hsl(var(--border) / 0.8)',
              background: 'hsl(var(--background) / 0.45)',
              color: 'hsl(var(--foreground))',
              fontSize: '0.73rem',
              fontWeight: 500,
              outline: 'none'
            }}
          />

          <button
            onClick={onTeleport}
            disabled={mapLoading || !Number.isFinite(mapLat) || !Number.isFinite(mapLng)}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '8px',
              border: 'none',
              background: 'hsl(var(--primary))',
              color: 'hsl(var(--primary-foreground))',
              fontWeight: 700,
              fontSize: '0.73rem',
              cursor: mapLoading ? 'not-allowed' : 'pointer',
              opacity: mapLoading ? 0.65 : 1,
              transition: 'opacity 0.2s ease, background-color 0.2s ease'
            }}
          >
            Teleport
          </button>
        </div>
      </div>
    </div>
  );
}
