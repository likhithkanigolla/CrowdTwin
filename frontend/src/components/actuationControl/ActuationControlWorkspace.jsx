// Full-screen map workspace with floating glass overlays.
// - Map fills the entire viewport (under everything else)
// - Floating panels slide in from left/right/top
// - Timetable opens as a separate full-screen overlay (TimetableStudio)
// - OSM data (roads + buildings) is fetched per active config and shared
//   with the GateRoadControlPanel and BuildingConfigPanel.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCampusConfigStore } from "@/hooks/useCampusConfigStore";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useOverpassData } from "@/hooks/useOverpassData";
import CampusMap2D from "./CampusMap2D";
import ConfigDetectionBar from "./ConfigDetectionBar";
import CampusSetupWizard from "./CampusSetupWizard";
import BuildingConfigPanel from "./BuildingConfigPanel";
import TimetableStudio from "./TimetableStudio";
import GateRoadControlPanel from "./GateRoadControlPanel";
import DisplayRoutePanel from "./DisplayRoutePanel";
import RuleAutomationPanel from "./RuleAutomationPanel";
import ActionQueueAuditPanel from "./ActionQueueAuditPanel";
import VirtualActuationPanel from "./VirtualActuationPanel";
import { Button } from "@/components/ui/button";
import {
  Download, Upload, RotateCcw, Sun, Moon, PanelLeftOpen, PanelRightOpen,
  PanelLeftClose, PanelRightClose, Activity, CalendarClock, Building2, Route,
  Monitor, Bot, ListChecks, Loader2, RefreshCw, Layers, Zap, SlidersHorizontal,
} from "lucide-react";

const DEFAULT_CENTER = { lng: 78.3487, lat: 17.4464 };

const RIGHT_TABS = [
  { key: "virtual",  label: "Control",  Icon: SlidersHorizontal },
  { key: "gates",    label: "Gates",    Icon: Route   },
  { key: "displays", label: "Displays", Icon: Monitor },
  { key: "rules",    label: "Rules",    Icon: Bot     },
  { key: "queue",    label: "Queue",    Icon: ListChecks },
];

export default function ActuationControlWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const store = useCampusConfigStore();
  const audit = useAuditLog();

  const [activeId, setActiveId] = useState(store.configs[0]?.id || null);
  const [cursor, setCursor] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardSeed, setWizardSeed] = useState(null);
  const [theme, setTheme] = useState("light");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState("virtual");
  const [timetableOpen, setTimetableOpen] = useState(false);
  const [highlightRoadId, setHighlightRoadId] = useState(null);
  const [mapIssue, setMapIssue] = useState("");

  // theme apply
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (!store.configs.find((c) => c.id === activeId)) {
      setActiveId(store.configs[0]?.id || null);
    }
  }, [store.configs, activeId]);

  const activeConfig = useMemo(
    () => store.configs.find((c) => c.id === activeId) || null,
    [store.configs, activeId]
  );
  const center = activeConfig?.center || DEFAULT_CENTER;
  const radius = activeConfig?.radiusMeters || 400;

  const { roads, buildings: osmBuildings, loading: osmLoading, error: osmError, refetch } =
    useOverpassData(center, Math.max(250, radius), Boolean(activeConfig));

  const openWizard = (seed) => {
    setWizardSeed(seed || center);
    setWizardOpen(true);
  };

  const onCreate = (cfg) => {
    store.upsertConfig(cfg);
    setActiveId(cfg.id);
    audit.log({ action: "config.create", target: cfg.id, after: cfg });
  };

  const onImport = async (file) => {
    try {
      await store.importJson(file);
      audit.log({ action: "config.import", target: file.name });
    } catch (e) {
      alert(`Import failed: ${e.message}`);
    }
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-background text-foreground">
      {/* MAP — full screen, beneath every overlay */}
      <CampusMap2D
        center={center}
        buildings={activeConfig?.buildings || []}
        gates={activeConfig?.gates || []}
        displays={activeConfig?.displays || []}
        themeMode={theme}
        onMapClick={setCursor}
        roads={roads}
        osmBuildings={osmBuildings}
        highlightRoadId={highlightRoadId}
        onRoadClick={(props) => setHighlightRoadId(props?.id || null)}
        onBuildingClick={() => { /* future: open building detail */ }}
        onRenderIssue={setMapIssue}
      />

      {/* TOP BAR — floating glass header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
        <div className="ct-panel pointer-events-auto flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground shadow-elevated">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">CrowdTwin</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {activeConfig?.campusName || "No campus selected"}
              </div>
            </div>
          </div>

          <div className="mx-2 flex items-center gap-1 rounded-md border border-border/70 bg-background/45 p-1">
            <Button
              size="sm"
              variant={location.pathname === '/visualize' ? 'secondary' : 'ghost'}
              onClick={() => navigate('/visualize')}
            >
              <Layers className="mr-1 h-3.5 w-3.5" />
              Visualize
            </Button>
            <Button
              size="sm"
              variant={location.pathname === '/actuate' ? 'secondary' : 'ghost'}
              onClick={() => navigate('/actuate')}
            >
              <Zap className="mr-1 h-3.5 w-3.5" />
              Actuate
            </Button>
            <Button
              size="sm"
              variant={location.pathname === '/simulate' ? 'secondary' : 'ghost'}
              onClick={() => navigate('/simulate')}
            >
              <Activity className="mr-1 h-3.5 w-3.5" />
              Simulate
            </Button>
          </div>

          <div className="mx-2 h-6 w-px bg-border" />

          <ConfigDetectionBar
            configs={store.configs}
            cursor={cursor}
            activeConfigId={activeId}
            onSelectConfig={setActiveId}
            onCreateConfig={openWizard}
          />

          <div className="ml-auto flex items-center gap-1">
            {osmLoading && (
              <span className="ct-chip text-[10px]">
                <Loader2 className="h-3 w-3 animate-spin" /> OSM…
              </span>
            )}
            {osmError && (
              <span className="ct-chip text-[10px] text-destructive" title={osmError}>OSM error</span>
            )}
            {mapIssue && (
              <span className="ct-chip max-w-[260px] truncate text-[10px] text-destructive" title={mapIssue}>
                Map error: {mapIssue}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={refetch} title="Refresh OSM data">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <div className="mx-1 h-5 w-px bg-border" />
            <label className="inline-flex">
              <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
              <Button asChild size="sm" variant="outline">
                <span><Upload className="mr-1 h-3.5 w-3.5" /> Import</span>
              </Button>
            </label>
            <Button size="sm" variant="outline" onClick={store.exportJson}>
              <Download className="mr-1 h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { if (confirm("Reset to seed data? This wipes local edits.")) store.resetToSeed(); }} title="Reset to seed">
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* LEFT TOGGLE (when collapsed) */}
      {!leftOpen && (
        <Button
          size="icon" variant="secondary"
          className="absolute left-3 top-24 z-20 shadow-elevated"
          onClick={() => setLeftOpen(true)} title="Open buildings panel"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      )}
      {!rightOpen && (
        <Button
          size="icon" variant="secondary"
          className="absolute right-3 top-24 z-20 shadow-elevated"
          onClick={() => setRightOpen(true)} title="Open control panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      )}

      {/* LEFT PANEL — floating */}
      {leftOpen && activeConfig && (
        <aside className="absolute bottom-3 left-3 top-24 z-10 flex w-[340px] max-w-[85vw] flex-col">
          <div className="ct-panel flex items-center gap-2 px-3 py-2">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Campus buildings</span>
            <Button size="icon" variant="ghost" className="ml-auto" onClick={() => setLeftOpen(false)}>
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 flex-1 overflow-y-auto pr-1">
            <BuildingConfigPanel
              config={activeConfig}
              store={store}
              osmBuildings={osmBuildings}
              loadingBuildings={osmLoading}
            />
          </div>
        </aside>
      )}

      {/* EMPTY STATE — no config */}
      {!activeConfig && (
        <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="ct-panel max-w-md space-y-3 p-6 text-center">
            <Activity className="mx-auto h-8 w-8 text-primary" />
            <div className="text-base font-semibold">No campus configuration</div>
            <p className="text-sm text-muted-foreground">
              Click anywhere on the map to probe nearby configurations, or create one for the current center.
            </p>
            <Button onClick={() => openWizard(center)}>Create campus configuration</Button>
          </div>
        </div>
      )}

      {/* RIGHT PANEL — floating, tabbed */}
      {rightOpen && activeConfig && (
        <aside className="absolute bottom-3 right-3 top-24 z-10 flex w-[400px] max-w-[90vw] flex-col">
          <div className="ct-panel flex flex-wrap items-center gap-1 p-1">
            {RIGHT_TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setRightTab(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition ${
                  rightTab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
            <Button size="icon" variant="ghost" onClick={() => setRightOpen(false)} title="Close">
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-2 flex-1 overflow-y-auto pl-1">
            {rightTab === "virtual" && (
              <VirtualActuationPanel
                config={activeConfig}
                store={store}
                audit={audit}
              />
            )}
            {rightTab === "gates" && (
              <GateRoadControlPanel
                config={activeConfig}
                store={store}
                audit={audit}
                roads={roads}
                loadingRoads={osmLoading}
                onHighlightRoad={setHighlightRoadId}
              />
            )}
            {rightTab === "displays" && <DisplayRoutePanel config={activeConfig} store={store} audit={audit} />}
            {rightTab === "rules" && <RuleAutomationPanel config={activeConfig} store={store} audit={audit} />}
            {rightTab === "queue" && <ActionQueueAuditPanel config={activeConfig} audit={audit} />}
          </div>
        </aside>
      )}

      {/* BOTTOM CENTER — quick stats + open timetable */}
      {activeConfig && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <div className="ct-panel pointer-events-auto flex items-center gap-2 px-3 py-2 text-xs">
            <span className="ct-chip">{activeConfig.buildings.length} buildings</span>
            <span className="ct-chip">{activeConfig.gates.length} gates</span>
            <span className="ct-chip">{activeConfig.displays.length} displays</span>
            <span className="ct-chip">{(activeConfig.timetables || []).length} timetable slots</span>
            <Button size="sm" onClick={() => setTimetableOpen(true)}>
              <CalendarClock className="mr-1 h-3.5 w-3.5" /> Open Timetable Studio
            </Button>
          </div>
        </div>
      )}

      <CampusSetupWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        defaultCenter={wizardSeed}
        onCreate={onCreate}
      />

      {activeConfig && (
        <TimetableStudio
          open={timetableOpen}
          onClose={() => setTimetableOpen(false)}
          config={activeConfig}
          store={store}
        />
      )}
    </div>
  );
}
