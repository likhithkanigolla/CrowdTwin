import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ModeToggle from './components/ModeToggle';
import MapContainer from './components/MapContainer';
import BuildingPanel from './components/BuildingPanel';
import RightSidePanel from './components/RightSidePanel';
import CSVUploadPanel from './components/CSVUploadPanel';
import ActuationControlWorkspace from './components/actuationControl/ActuationControlWorkspace';
import { useSchedule } from './hooks/useSchedule';
import {
  clearPedSimState,
  PEDSIM_WS_CANDIDATES,
  getPedSimState,
  getPedSimRuntimeStatus,
  startPedSimRuntime,
  stopPedSimRuntime,
} from './api';

// How fast time runs:  1 real second = N simulated minutes
const SIM_SPEED_MINUTES_PER_SECOND = 1; // 1s real = 1 min sim by default
const PEDSIM_STREAM_FLUSH_MS = Math.min(
  100,
  Math.max(4, Number(import.meta.env.VITE_PEDSIM_STREAM_FLUSH_MS) || 8)
);
const PEDSIM_STALE_FRAME_MS = Math.max(90, PEDSIM_STREAM_FLUSH_MS * 6);
const PEDSIM_FALLBACK_POLL_MS = Math.max(60, Math.floor(PEDSIM_STREAM_FLUSH_MS * 4));

// Default focus area as polygon points
const DEFAULT_POLYGON = {
  points: [
    { lat: 17.444367264099508, lng: 78.34452457988155 },
    { lat: 17.448797391748382, lng: 78.34838358854786 },
    { lat: 17.445193097471517, lng: 78.35201607258138 },
    { lat: 17.44226793257296, lng: 78.3496861051025 }
  ]
};

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const validModes = ['visualize', 'actuate', 'simulate'];
  const pathMode = location.pathname.replace(/^\//, '');
  const currentMode = validModes.includes(pathMode) ? pathMode : 'visualize';

  const setMode = (mode) => {
    const nextMode = validModes.includes(mode) ? mode : 'visualize';
    navigate(`/${nextMode}`);
  };
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [availableBuildings, setAvailableBuildings] = useState([]);
  const [actuationEvents, setActuationEvents] = useState([]);
  const [simulatorReadyToken, setSimulatorReadyToken] = useState(0);
  const [mapBoundaryPreview, setMapBoundaryPreview] = useState(null);
  const [pedsimSceneStatus, setPedSimSceneStatus] = useState(null);
  const [pedsimRuntimeStatus, setPedSimRuntimeStatus] = useState(null);
  const [mapLat, setMapLat] = useState(17.4464);
  const [mapLng, setMapLng] = useState(78.3487);
  const [mapLoading, setMapLoading] = useState(false);
  const [teleportRequestId, setTeleportRequestId] = useState(0);

  // Focus area state (lifted from MapContainer)
  const [areaPoints, setAreaPoints] = useState([]);
  const [selectedArea, setSelectedArea] = useState(null);
  const [isPlacingPoints, setIsPlacingPoints] = useState(false);

  // Load schedule from backend on mount
  useSchedule();

  useEffect(() => {
    if (!validModes.includes(pathMode)) {
      navigate('/visualize', { replace: true });
    }
  }, [navigate, pathMode]);

  const [simTime, setSimTime] = useState(7.75);
  const [isRunning, setIsRunning] = useState(false); // False by default - only run in simulation
  const [speed, setSpeed] = useState(SIM_SPEED_MINUTES_PER_SECOND);
  const intervalRef = useRef(null);

  // Live occupancy from CrowdSimulator
  const simulatorRef = useRef(null);
  const [liveCategoryOccupancy, setLiveCategoryOccupancy] = useState({});

  // Poll the simulator for live occupancy data every second
  useEffect(() => {
    const pollOccupancy = setInterval(() => {
      if (simulatorRef.current && simulatorRef.current.running) {
        const occ = simulatorRef.current.getBuildingOccupancy();
        setLiveCategoryOccupancy(occ.categoryOccupancy);
      }
    }, 1000);

    return () => clearInterval(pollOccupancy);
  }, []);

  // Auto-running clock (only in simulation mode)
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    // Timer should only run in simulation mode and when isRunning is true
    if (!isRunning || currentMode !== 'simulate') {
      return;
    }

    intervalRef.current = setInterval(() => {
      setSimTime(prev => {
        const next = prev + speed / 60; // speed minutes / 60 = fractional hours
        return next >= 24 ? 0 : next;   // Loop midnight
      });
    }, 1000); // tick every real second

    return () => clearInterval(intervalRef.current);
  }, [isRunning, speed, currentMode]);

  const formatTime = (decimalHours) => {
    const hrs = Math.floor(decimalHours) % 24;
    const mins = Math.floor((decimalHours - Math.floor(decimalHours)) * 60);
    const suffix = hrs >= 12 ? 'PM' : 'AM';
    const displayHrs = hrs % 12 === 0 ? 12 : hrs % 12;
    return `${displayHrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${suffix}`;
  };

  // Focus area helpers
  const togglePointPlacement = () => {
    setIsPlacingPoints(prev => !prev);
    if (isPlacingPoints) {
      setAreaPoints([]);
    }
  };

  const useDefaultArea = () => {
    setSelectedArea(DEFAULT_POLYGON);
    setAreaPoints([]);
    setIsPlacingPoints(false);
  };

  const clearAreaSelection = () => {
    setSelectedArea(null);
    setAreaPoints([]);
    setIsPlacingPoints(false);
  };

  const requestMapTeleport = () => {
    if (!Number.isFinite(mapLat) || !Number.isFinite(mapLng)) {
      return;
    }
    setTeleportRequestId((prev) => prev + 1);
  };

  // Handle simulator actions from RightSidePanel
  const handleSimulatorAction = async (action) => {
    const sim = simulatorRef.current;
    
    switch (action.type) {
      case 'start_simulation':
        try {
          const requestedPopulation = Number(
            action?.pedsimControls?.default_agent_count ?? action?.initialPopulation ?? 0
          );
          const requestedRuleFollowRatio = Number(action?.pedsimControls?.rule_follow_ratio);
          const requestedAgentSpeed = Number(action?.pedsimControls?.agent_speed);
          const requestedSpawnGroups = Array.isArray(action?.spawnGroups)
            ? action.spawnGroups
              .map((group) => ({
                start_index: Math.max(0, Math.floor(Number(group?.start_index) || 0)),
                count: Math.max(1, Math.floor(Number(group?.count) || 1)),
                cohort_id: String(group?.cohort_id || 'pedsim').toLowerCase(),
                color: typeof group?.color === 'string' ? group.color : null,
              }))
            : [];
          const sceneReadyForControls = pedsimSceneStatus?.status === 'ready';

          const runtimeStartPayload = {
            scene_file: pedsimSceneStatus?.demoapp_scene_file || undefined,
            listen_port: 2222,
            force_restart: true,
          };

          if (sceneReadyForControls) {
            runtimeStartPayload.default_agent_count = Number.isFinite(requestedPopulation) && requestedPopulation > 0
              ? Math.round(requestedPopulation)
              : undefined;
            runtimeStartPayload.rule_follow_ratio = Number.isFinite(requestedRuleFollowRatio)
              ? requestedRuleFollowRatio
              : undefined;
            runtimeStartPayload.agent_speed = Number.isFinite(requestedAgentSpeed)
              ? requestedAgentSpeed
              : undefined;
            runtimeStartPayload.spawn_groups = requestedSpawnGroups;
          }

          const runtimeStatus = await startPedSimRuntime(runtimeStartPayload);
          setPedSimRuntimeStatus(runtimeStatus);
        } catch (error) {
          setPedSimRuntimeStatus({
            running: false,
            error: error?.message || 'Unable to start PedSim runtime',
          });
          return {
            ok: false,
            message: error?.message || 'Unable to start PedSim runtime',
          };
        }

        // PedSim-only start: clear existing agents and wait for PedSim frames.
        // If map simulator is still initializing, keep runtime start successful.
        if (sim) {
          sim.clearAgents();

          if (action.roadClosures) {
            action.roadClosures.forEach(road => {
              sim.setRoadClosure(road.road_id, road.status);
            });
          }

          sim.startCustomSimulation(action.schedule, action.initialPopulation);
        }

        return {
          ok: true,
          message: sim ? null : 'Runtime started while map simulator is still initializing.'
        };
        
      case 'stop_simulation':
        if (sim) {
          sim.stopCustomSimulation();
          sim.clearAgents();
        }
        clearPedSimState().catch(() => {});

        try {
          const runtimeStatus = await stopPedSimRuntime();
          setPedSimRuntimeStatus(runtimeStatus);
        } catch (error) {
          setPedSimRuntimeStatus((prev) => ({
            ...(prev || {}),
            running: false,
            error: error?.message || 'Unable to stop PedSim runtime cleanly',
          }));
        }

        return { ok: true };
        
      case 'road_closure':
        if (!sim) {
          return { ok: false, message: 'Simulator is not ready yet.' };
        }
        sim.setRoadClosure(action.road_id, action.status);
        return { ok: true };
        
      case 'clear_road':
        if (!sim) {
          return { ok: false, message: 'Simulator is not ready yet.' };
        }
        sim.setRoadClosure(action.road_id, 'open');
        return { ok: true };
        
      default:
        console.log('Unknown simulator action:', action.type);
        return { ok: false, message: 'Unknown simulator action.' };
    }
  };

  useEffect(() => {
    if (currentMode !== 'simulate') {
      return;
    }

    let cancelled = false;

    const loadRuntimeStatus = async () => {
      try {
        const status = await getPedSimRuntimeStatus();
        if (!cancelled) {
          setPedSimRuntimeStatus(status);
        }
      } catch (error) {
        if (!cancelled) {
          setPedSimRuntimeStatus((prev) => prev || { running: false });
        }
      }
    };

    loadRuntimeStatus();
    const intervalId = setInterval(loadRuntimeStatus, 2000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [currentMode]);

  // PedSim-only stream consumer for simulation mode.
  useEffect(() => {
    if (currentMode !== 'simulate' || simulatorReadyToken === 0 || !simulatorRef.current) {
      return;
    }

    let websocket = null;
    let cancelled = false;
    let lastFrameReceivedAt = 0;
    let latestFrame = null;
    let latestSequence = -1;
    let latestStreamId = null;
    let latestFrameTimestampMs = 0;
    let frameFlushRafId = null;

    const applyFrame = (frame) => {
      const simulator = simulatorRef.current;
      if (!simulator || !frame) return;

      simulator.applyPedSimState(frame);
    };

    const queueFrame = (frame) => {
      if (!frame) return;

      if (String(frame.type || '').toLowerCase() === 'heartbeat') {
        return;
      }

      const incomingStreamId = String(frame.stream_id ?? frame.streamId ?? '');
      if (incomingStreamId && incomingStreamId !== latestStreamId) {
        latestStreamId = incomingStreamId;
        latestSequence = -1;
        latestFrameTimestampMs = 0;
        latestFrame = null;
      }

      const frameTimestampMs = Date.parse(String(frame.timestamp || ''));

      const frameSequence = Number(frame.stream_sequence ?? frame.streamSequence ?? -1);
      if (Number.isFinite(frameSequence) && frameSequence >= 0) {
        if (frameSequence < latestSequence) {
          // If backend restarted and stream_id was missing/unchanged for any reason,
          // accept a clear forward jump in timestamp as a fresh stream.
          if (
            Number.isFinite(frameTimestampMs)
            && frameTimestampMs > (latestFrameTimestampMs + 250)
          ) {
            latestSequence = frameSequence;
          } else {
            return;
          }
        } else {
          latestSequence = frameSequence;
        }
      }

      if (Number.isFinite(frameTimestampMs) && frameTimestampMs > latestFrameTimestampMs) {
        latestFrameTimestampMs = frameTimestampMs;
      }

      latestFrame = frame;
      lastFrameReceivedAt = Date.now();
    };

    const connect = (index = 0) => {
      if (cancelled || index >= PEDSIM_WS_CANDIDATES.length) return;

      try {
        websocket = new WebSocket(PEDSIM_WS_CANDIDATES[index]);

        websocket.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data);
            queueFrame(frame);
          } catch (error) {
            console.warn('Invalid PedSim websocket payload:', error);
          }
        };

        websocket.onerror = () => {
          try {
            websocket?.close();
          } catch (closeError) {
            // ignore
          }
        };

        websocket.onclose = () => {
          if (!cancelled && index + 1 < PEDSIM_WS_CANDIDATES.length) {
            connect(index + 1);
          }
        };
      } catch (error) {
        connect(index + 1);
      }
    };

    connect();

    // Keep latency low under high frame rates by applying only the latest frame.
    const flushLatestFrame = (now) => {
      if (cancelled) return;

      if (latestFrame) {
        const frameToApply = latestFrame;
        latestFrame = null;
        applyFrame(frameToApply);
      }

      frameFlushRafId = requestAnimationFrame(flushLatestFrame);
    };
    frameFlushRafId = requestAnimationFrame(flushLatestFrame);

    const fallbackInterval = setInterval(async () => {
      if (cancelled) return;
      const stale = Date.now() - lastFrameReceivedAt > PEDSIM_STALE_FRAME_MS;
      if (!stale) return;

      try {
        const frame = await getPedSimState();
        queueFrame(frame);
      } catch (error) {
        // Fallback fetch is best effort only.
      }
    }, PEDSIM_FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      if (frameFlushRafId !== null) {
        cancelAnimationFrame(frameFlushRafId);
      }
      clearInterval(fallbackInterval);
      try {
        websocket?.close();
      } catch (error) {
        // ignore
      }
    };
  }, [currentMode, simulatorReadyToken]);

  if (currentMode === 'actuate') {
    return <ActuationControlWorkspace />;
  }

  return (
    <div className="app-layout">
      {/* 80% Map Section */}
      <div className="map-section">
        <MapContainer
          currentMode={currentMode}
          onBuildingSelect={setSelectedBuilding}
          onBuildingsLoaded={setAvailableBuildings}
          onSimulatorReady={(sim) => {
            simulatorRef.current = sim;
            setSimulatorReadyToken((prev) => prev + 1);
          }}
          onMapBoundaryChange={setMapBoundaryPreview}
          onPedSimSceneExport={setPedSimSceneStatus}
          simTime={simTime}
          isPlacingPoints={isPlacingPoints}
          setIsPlacingPoints={setIsPlacingPoints}
          areaPoints={areaPoints}
          setAreaPoints={setAreaPoints}
          selectedArea={selectedArea}
          setSelectedArea={setSelectedArea}
          mapLat={mapLat}
          mapLng={mapLng}
          onMapLoadingChange={setMapLoading}
          teleportRequestId={teleportRequestId}
        />

        <div className="ui-layer">
          <ModeToggle
            currentMode={currentMode}
            setMode={setMode}
            mapLat={mapLat}
            mapLng={mapLng}
            setMapLat={setMapLat}
            setMapLng={setMapLng}
            mapLoading={mapLoading}
            onTeleport={requestMapTeleport}
          />

          {selectedBuilding && (
            <BuildingPanel
              building={selectedBuilding}
              mode={currentMode}
              simTime={simTime}
            />
          )}
        </div>
      </div>

      {/* 20% Panel Section */}
      <div className="panel-section">
        <RightSidePanel
          mode={currentMode}
          simTime={simTime}
          setSimTime={setSimTime}
          isRunning={isRunning}
          setIsRunning={setIsRunning}
          speed={speed}
          setSpeed={setSpeed}
          formatTime={formatTime}
          availableBuildings={availableBuildings}
          actuationEvents={actuationEvents}
          setActuationEvents={setActuationEvents}
          liveCategoryOccupancy={liveCategoryOccupancy}
          onSimulatorAction={handleSimulatorAction}
          isPlacingPoints={isPlacingPoints}
          areaPoints={areaPoints}
          selectedArea={selectedArea}
          mapBoundaryPreview={mapBoundaryPreview}
          pedsimSceneStatus={pedsimSceneStatus}
          pedsimRuntimeStatus={pedsimRuntimeStatus}
          togglePointPlacement={togglePointPlacement}
          useDefaultArea={useDefaultArea}
          clearAreaSelection={clearAreaSelection}
        />
        <CSVUploadPanel />
      </div>
    </div>
  );
}

export default App;
