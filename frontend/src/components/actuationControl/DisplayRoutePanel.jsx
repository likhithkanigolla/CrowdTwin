import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Monitor, Plus, Trash2 } from "lucide-react";

const MODES = ["normal", "diversion", "emergency"];
const MODE_TONE = {
  normal: "border-status-green/40 text-status-green",
  diversion: "border-status-yellow/40 text-status-yellow",
  emergency: "border-status-red/40 text-status-red",
};

export default function DisplayRoutePanel({ config, store, audit }) {
  const [draft, setDraft] = useState({ name: "", lat: config.center.lat, lng: config.center.lng });

  const addDisplay = () => {
    if (!draft.name.trim()) return;
    const d = {
      id: `disp-${Date.now()}`,
      name: draft.name.trim(),
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      routeMode: "normal",
      activeMessage: "",
    };
    store.patchConfig(config.id, { displays: [...config.displays, d] });
    audit.log({ action: "display.create", target: d.id, after: d });
    setDraft({ name: "", lat: config.center.lat, lng: config.center.lng });
  };

  const removeDisplay = (id) => {
    const before = config.displays.find((d) => d.id === id);
    store.patchConfig(config.id, { displays: config.displays.filter((d) => d.id !== id) });
    audit.log({ action: "display.delete", target: id, before });
  };

  const update = (d, patch) => {
    const before = { ...d };
    const after = { ...d, ...patch };
    store.updateDisplay(config.id, d.id, after);
    audit.log({ action: "display.update", target: d.id, before, after });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Monitor className="h-4 w-4 text-primary" /> Display Route Control
      </div>

      <div className="ct-panel space-y-2 p-3">
        <Label className="text-xs">Add display</Label>
        <div className="grid grid-cols-12 gap-2">
          <Input className="col-span-5 h-8" placeholder="Display name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input className="col-span-3 h-8" type="number" step="0.00001" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} />
          <Input className="col-span-3 h-8" type="number" step="0.00001" value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: e.target.value })} />
          <Button size="sm" className="col-span-1 h-8" onClick={addDisplay}><Plus className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <div className="space-y-2">
        {config.displays.map((d) => (
          <div key={d.id} className="ct-panel space-y-2 p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{d.name}</span>
              <span className={`ct-chip ml-auto ${MODE_TONE[d.routeMode]}`}>{d.routeMode}</span>
              <Button size="icon" variant="ghost" onClick={() => removeDisplay(d.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <Button key={m} size="sm" variant={d.routeMode === m ? "secondary" : "outline"} onClick={() => update(d, { routeMode: m })}>
                  {m}
                </Button>
              ))}
            </div>

            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">Active message</Label>
              <Input className="h-8" value={d.activeMessage} onChange={(e) => update(d, { activeMessage: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Lat</Label>
                <Input className="h-8" type="number" step="0.00001" value={d.lat} onChange={(e) => update(d, { lat: Number(e.target.value) })} />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Lng</Label>
                <Input className="h-8" type="number" step="0.00001" value={d.lng} onChange={(e) => update(d, { lng: Number(e.target.value) })} />
              </div>
            </div>
          </div>
        ))}
        {config.displays.length === 0 && (
          <div className="ct-panel p-4 text-center text-xs text-muted-foreground">No displays configured.</div>
        )}
      </div>
    </div>
  );
}
