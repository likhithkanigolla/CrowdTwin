import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function RoomEquipmentEditor({ equipment, onChange }) {
  const eq = equipment || { pc: true, projector: true, mikeSetup: true, collarMikes: 0, handMikes: 0, extras: [] };
  const set = (patch) => onChange({ ...eq, ...patch });

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
      <ToggleField label="PC" checked={eq.pc} onCheckedChange={(v) => set({ pc: v })} />
      <ToggleField label="Projector" checked={eq.projector} onCheckedChange={(v) => set({ projector: v })} />
      <ToggleField label="Mike setup" checked={eq.mikeSetup} onCheckedChange={(v) => set({ mikeSetup: v })} />
      <NumField label="Collar" value={eq.collarMikes} onChange={(v) => set({ collarMikes: v })} />
      <NumField label="Hand" value={eq.handMikes} onChange={(v) => set({ handMikes: v })} />
      <div className="col-span-2 sm:col-span-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Extras</Label>
        <Input
          className="h-8"
          placeholder="csv"
          value={(eq.extras || []).join(", ")}
          onChange={(e) => set({ extras: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </div>
    </div>
  );
}

function ToggleField({ label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <span className="text-xs">{label}</span>
      <Switch checked={!!checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function NumField({ label, value, onChange }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input className="h-8" type="number" min="0" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
