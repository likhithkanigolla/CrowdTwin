import { useState, useEffect, useRef } from 'react';
import ModeToggle from './components/ModeToggle';
import MapContainer from './components/MapContainer';
import BuildingPanel from './components/BuildingPanel';
import RightSidePanel from './components/RightSidePanel';
import CSVUploadPanel from './components/CSVUploadPanel';
import { useSchedule } from './hooks/useSchedule';

// How fast time runs:  1 real second = N simulated minutes
const SIM_SPEED_MINUTES_PER_SECOND = 1; // 1s real = 1 min sim by default

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
  const [currentMode, setMode] = useState('visualize');
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [availableBuildings, setAvailableBuildings] = useState([]);
  const [actuationEvents, setActuationEvents] = useState([]);

  // Focus area state (lifted from MapContainer)
const [areaPoints, setAreaPoints] = useState([]);
const [selectedArea, setSelectedArea] = useState(null);
const [isPlacingPoints, setIsPlacingPoints] = useState(false);

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

  return (
    <div className="app-layout">
      {/* 80% Map Section */}
      <div className="map-section">
        <MapContainer
          currentMode={currentMode}
          onBuildingSelect={setSelectedBuilding}
          onBuildingsLoaded={setAvailableBuildings}
          simTime={simTime}
          isPlacingPoints={isPlacingPoints}
          setIsPlacingPoints={setIsPlacingPoints}
          areaPoints={areaPoints}
          setAreaPoints={setAreaPoints}
          selectedArea={selectedArea}
          setSelectedArea={setSelectedArea}
        />

        <div className="ui-layer">
          <ModeToggle currentMode={currentMode} setMode={setMode} />

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
          isPlacingPoints={isPlacingPoints}
          areaPoints={areaPoints}
          selectedArea={selectedArea}
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
