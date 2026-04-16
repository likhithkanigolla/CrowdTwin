import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DoorOpen, DoorClosed, Plus, Trash2, Route, MapPin } from "lucide-react";
import { deriveRoadStatus } from "@/utils/geo";
import { pointAlong } from "@/utils/overpass";

const STATUS_LABEL = { green: "Open", yellow: "Partial", red: "Closed" };

function formatCoord(value, digits = 5) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}

export default function GateRoadControlPanel({
  config,
  store,
  audit,
  roads = [],
  loadingRoads = false,
  onHighlightRoad,
}) {
  const [selectedRoadId, setSelectedRoadId] = useState(roads[0]?.id || "");
  const [position, setPosition] = useState(0.5);
  const [name, setName] = useState("");

  const selectedRoad = useMemo(
    () => roads.find((r) => r.id === selectedRoadId) || null,
    [roads, selectedRoadId]
  );

  const totals = config.gates.reduce((acc, g) => {
    acc[g.derivedRoadStatus] = (acc[g.derivedRoadStatus] || 0) + 1;
    return acc;
  }, {});

  // Group existing gates by the road they belong to
  const gatesByRoad = useMemo(() => {
    const map = new Map();
    for (const g of config.gates) {
      const k = g.roadId || "__free__";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(g);
    }
    return map;
  }, [config.gates]);

  const addGateOnRoad = () => {
    if (!selectedRoad) return;
    const pt = pointAlong(selectedRoad.coords, Number(position));
    if (!pt) return;
    const gateName = name.trim() || `${selectedRoad.name} Gate`;
    const gate = {
      id: `gate-${Date.now()}`,
      name: gateName,
      lat: pt.lat,
      lng: pt.lng,
      roadId: selectedRoad.id,
      roadName: selectedRoad.name,
      roadPosition: Number(position),
      sideAStatus: "open",
      sideBStatus: "open",
      derivedRoadStatus: "green",
    };
    store.patchConfig(config.id, { gates: [...config.gates, gate] });
    audit.log({ action: "gate.create", target: gate.id, after: gate });
    setName("");
  };

  const removeGate = (id) => {
    const before = config.gates.find((g) => g.id === id);
    store.patchConfig(config.id, { gates: config.gates.filter((g) => g.id !== id) });
    audit.log({ action: "gate.delete", target: id, before });
  };

  const toggle = (gate, side) => {
    const before = { ...gate };
    const key = side === "A" ? "sideAStatus" : "sideBStatus";
    const next = gate[key] === "open" ? "closed" : "open";
    const after = { ...gate, [key]: next };
    after.derivedRoadStatus = deriveRoadStatus(after);
    store.updateGate(config.id, gate.id, after);
    audit.log({ action: `gate.toggle.${side}`, target: gate.id, before, after });
    // TODO: controlRoad(gate.roadId, after.derivedRoadStatus)
  };

  const moveAlongRoad = (gate, t) => {
    const road = roads.find((r) => r.id === gate.roadId);
    if (!road) return;
    const pt = pointAlong(road.coords, t);
    const before = { ...gate };
    const after = { ...gate, lat: pt.lat, lng: pt.lng, roadPosition: t };
    store.updateGate(config.id, gate.id, after);
    audit.log({ action: "gate.move", target: gate.id, before, after });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Route className="h-4 w-4 text-primary" /> Roads & Gates
      </div>

      <div className="ct-panel grid grid-cols-3 gap-2 p-3 text-center text-xs">
        <SummaryChip label="Open" count={totals.green || 0} cls="ct-status-green" />
        <SummaryChip label="Partial" count={totals.yellow || 0} cls="ct-status-yellow" />
        <SummaryChip label="Closed" count={totals.red || 0} cls="ct-status-red" />
      </div>

      <div className="ct-panel space-y-2 p-3">
        <Label className="text-xs">Place a gate on a road</Label>
        {loadingRoads && (
          <div className="text-xs text-muted-foreground">Loading roads from OpenStreetMap…</div>
        )}
        {!loadingRoads && roads.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No roads found within the current radius. Increase the campus radius or move the center.
          </div>
        )}
        {roads.length > 0 && (
          <>
            <select
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              value={selectedRoadId}
              onChange={(e) => { setSelectedRoadId(e.target.value); onHighlightRoad?.(e.target.value); }}
              onFocus={(e) => onHighlightRoad?.(e.target.value)}
            >
              {roads.map((r) => (
                <option key={r.id} value={r.id}>{r.name} · {r.type}</option>
              ))}
            </select>
            <div className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-6">
                <Label className="text-[10px] uppercase text-muted-foreground">Gate name</Label>
                <Input className="h-8" placeholder={selectedRoad ? `${selectedRoad.name} Gate` : ""} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="col-span-4">
                <Label className="text-[10px] uppercase text-muted-foreground">Position along road</Label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={position}
                  onChange={(e) => setPosition(Number(e.target.value))}
                  className="h-8 w-full"
                />
              </div>
              <Button size="sm" className="col-span-2 h-8" onClick={addGateOnRoad}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-2">
        {config.gates.map((g) => (
          <div key={g.id} className="ct-panel space-y-2 p-3">
            <div className="flex items-center gap-2">
              <span className={`ct-status-dot ct-status-${g.derivedRoadStatus}`} />
              <span className="text-sm font-medium">{g.name}</span>
              <span className="ct-chip ml-auto">{STATUS_LABEL[g.derivedRoadStatus]}</span>
              <Button size="icon" variant="ghost" onClick={() => removeGate(g.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{g.roadName || g.roadId || "no road link"}</span>
              <span className="ct-mono ml-auto">{formatCoord(g.lat)}, {formatCoord(g.lng)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant={g.sideAStatus === "open" ? "secondary" : "outline"} onClick={() => toggle(g, "A")}>
                {g.sideAStatus === "open" ? <DoorOpen className="mr-1 h-3.5 w-3.5" /> : <DoorClosed className="mr-1 h-3.5 w-3.5" />}
                Side A: {g.sideAStatus}
              </Button>
              <Button size="sm" variant={g.sideBStatus === "open" ? "secondary" : "outline"} onClick={() => toggle(g, "B")}>
                {g.sideBStatus === "open" ? <DoorOpen className="mr-1 h-3.5 w-3.5" /> : <DoorClosed className="mr-1 h-3.5 w-3.5" />}
                Side B: {g.sideBStatus}
              </Button>
            </div>
            {g.roadId && roads.find((r) => r.id === g.roadId) && (
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Slide along road</Label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={g.roadPosition ?? 0.5}
                  onChange={(e) => moveAlongRoad(g, Number(e.target.value))}
                  onMouseEnter={() => onHighlightRoad?.(g.roadId)}
                  className="h-6 w-full"
                />
              </div>
            )}
          </div>
        ))}
        {config.gates.length === 0 && (
          <div className="ct-panel p-4 text-center text-xs text-muted-foreground">
            No gates yet. Pick a road above and place a gate.
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryChip({ label, count, cls }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="flex items-center justify-center gap-1.5">
        <span className={`ct-status-dot ${cls}`} />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <div className="ct-mono mt-1 text-lg">{count}</div>
    </div>
  );
}
