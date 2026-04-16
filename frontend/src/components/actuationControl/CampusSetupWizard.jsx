import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function CampusSetupWizard({ open, onClose, defaultCenter, onCreate }) {
  const [name, setName] = useState("New Campus");
  const [lat, setLat] = useState(defaultCenter?.lat ?? 17.4464);
  const [lng, setLng] = useState(defaultCenter?.lng ?? 78.3487);
  const [radius, setRadius] = useState(250);

  useEffect(() => {
    if (!open) return;
    setLat(defaultCenter?.lat ?? 17.4464);
    setLng(defaultCenter?.lng ?? 78.3487);
  }, [defaultCenter?.lat, defaultCenter?.lng, open]);

  const submit = () => {
    const cfg = {
      id: `cfg-${Date.now()}`,
      campusName: name.trim() || "New Campus",
      center: { lat: Number(lat), lng: Number(lng) },
      radiusMeters: Math.max(25, Number(radius) || 250),
      buildings: [],
      gates: [],
      displays: [],
      timetables: [],
      rules: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onCreate(cfg);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create campus configuration</DialogTitle>
          <DialogDescription>
            No configuration found near this point. Define a new campus and its actuation radius.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cn">Campus name</Label>
            <Input id="cn" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="clat">Center latitude</Label>
              <Input id="clat" type="number" step="0.00001" value={lat} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="clng">Center longitude</Label>
              <Input id="clng" type="number" step="0.00001" value={lng} onChange={(e) => setLng(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cr">Radius (meters)</Label>
            <Input id="cr" type="number" min="25" value={radius} onChange={(e) => setRadius(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
