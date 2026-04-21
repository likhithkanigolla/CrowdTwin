// Buildings come from the map (OSM footprints). The user picks which OSM
// building belongs to the campus, names it, then configures floors/rooms/equipment.
// Selected campus buildings persist with osmBuildingId so we can re-link the
// footprint on subsequent loads.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Plus, Trash2, ChevronDown, ChevronRight, MapPin } from "lucide-react";
import FloorRoomEditor from "./FloorRoomEditor";

function formatCoord(value, digits = 5) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}

export default function BuildingConfigPanel({
  config,
  store,
  osmBuildings = [],
  loadingBuildings = false,
}) {
  const [openId, setOpenId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState("");

  // OSM buildings not yet imported into the campus config
  const registeredOsmIds = useMemo(
    () => new Set(config.buildings.map((b) => b.osmBuildingId).filter(Boolean)),
    [config.buildings]
  );
  const candidates = useMemo(
    () =>
      osmBuildings
        .filter((b) => !registeredOsmIds.has(b.osmId))
        .filter((b) => !filter.trim() || b.name.toLowerCase().includes(filter.toLowerCase()))
        .slice(0, 50),
    [osmBuildings, registeredOsmIds, filter]
  );

  const importBuilding = (osmBld, customName) => {
    const newBld = {
      id: `bld-${Date.now()}`,
      osmBuildingId: osmBld.osmId,
      name: customName?.trim() || osmBld.name,
      lat: osmBld.center.lat,
      lng: osmBld.center.lng,
      footprint: osmBld.coords,
      floors: [{ floorNumber: 0, rooms: [] }],
    };
    store.addBuilding(config.id, newBld);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Building2 className="h-4 w-4 text-primary" /> Buildings ({config.buildings.length})
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setPickerOpen((v) => !v)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> From map
        </Button>
      </div>

      {pickerOpen && (
        <div className="ct-panel space-y-2 p-3">
          <div className="flex items-center gap-2">
            <Input
              className="h-8"
              placeholder="Filter footprints by name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {loadingBuildings && (
            <div className="text-xs text-muted-foreground">Loading building footprints from OpenStreetMap…</div>
          )}
          {!loadingBuildings && osmBuildings.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No building footprints found in this radius. Increase the campus radius.
            </div>
          )}
          <div className="max-h-64 space-y-1 overflow-auto pr-1">
            {candidates.map((b) => (
              <PickRow key={b.osmId} osm={b} onImport={(name) => importBuilding(b, name)} />
            ))}
            {!loadingBuildings && candidates.length === 0 && osmBuildings.length > 0 && (
              <div className="rounded-md border border-dashed border-border p-2 text-center text-xs text-muted-foreground">
                All matching footprints already imported.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {config.buildings.length === 0 && (
          <div className="ct-panel p-4 text-center text-xs text-muted-foreground">
            No buildings yet. Click <strong>From map</strong> to pick footprints from OpenStreetMap.
          </div>
        )}
        {config.buildings.map((b) => {
          const open = openId === b.id;
          return (
            <div key={b.id} className="ct-panel">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  className="flex flex-1 items-center gap-2 text-left text-sm"
                  onClick={() => setOpenId(open ? null : b.id)}
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-medium">{b.name}</span>
                  {b.osmBuildingId && <span className="ct-chip text-[10px]">OSM</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {b.floors.length} floor{b.floors.length === 1 ? "" : "s"} ·{" "}
                    {b.floors.reduce((n, f) => n + f.rooms.length, 0)} rooms
                  </span>
                </button>
                <Button size="icon" variant="ghost" onClick={() => store.removeBuilding(config.id, b.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5 px-3 pb-2 text-[11px] text-muted-foreground">
                <MapPin className="h-3 w-3" />
                <span className="ct-mono">{formatCoord(b.lat)}, {formatCoord(b.lng)}</span>
              </div>
              {open && (
                <div className="border-t border-border/60 p-3">
                  <FloorRoomEditor
                    config={config}
                    building={b}
                    onChange={(patch) => store.updateBuilding(config.id, b.id, patch)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PickRow({ osm, onImport }) {
  const [name, setName] = useState(osm.name);
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2">
      <Input className="h-7 flex-1 text-xs" value={name} onChange={(e) => setName(e.target.value)} />
      <span className="ct-mono text-[10px] text-muted-foreground">
        {formatCoord(osm.center.lat, 4)}, {formatCoord(osm.center.lng, 4)}
      </span>
      <Button size="sm" className="h-7" onClick={() => onImport(name)}>Add</Button>
    </div>
  );
}
