import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import RoomEquipmentEditor from "./RoomEquipmentEditor";

const ROOM_TYPES = ["classroom", "lab", "seminar", "auditorium", "office", "other"];

export default function FloorRoomEditor({ building, onChange }) {
  const [expandedRoomId, setExpandedRoomId] = useState(null);
  const toggleExpand = (id) => setExpandedRoomId(prev => prev === id ? null : id);
  const setFloors = (floors) => onChange({ floors });

  const addFloor = () => {
    const next = (building.floors.at(-1)?.floorNumber ?? -1) + 1;
    setFloors([...building.floors, { floorNumber: next, rooms: [] }]);
  };

  const removeFloor = (n) => setFloors(building.floors.filter((f) => f.floorNumber !== n));

  const updateFloor = (n, patch) =>
    setFloors(building.floors.map((f) => (f.floorNumber === n ? { ...f, ...patch } : f)));

  const addRoom = (n) => {
    const room = {
      id: `rm-${Date.now()}`,
      name: "New Room",
      capacity: 30,
      roomType: "classroom",
      equipment: { pc: true, projector: true, mikeSetup: true, collarMikes: 1, handMikes: 2, extras: [] },
    };
    updateFloor(n, { rooms: [...(building.floors.find((f) => f.floorNumber === n)?.rooms || []), room] });
  };

  const updateRoom = (n, roomId, patch) =>
    updateFloor(n, {
      rooms: building.floors.find((f) => f.floorNumber === n).rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
    });

  const removeRoom = (n, roomId) =>
    updateFloor(n, {
      rooms: building.floors.find((f) => f.floorNumber === n).rooms.filter((r) => r.id !== roomId),
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Floors</span>
        <Button size="sm" variant="outline" onClick={addFloor}><Plus className="mr-1 h-3.5 w-3.5" /> Floor</Button>
      </div>

      {building.floors.map((floor) => (
        <div key={floor.floorNumber} className="rounded-lg border border-border/70 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="ct-chip">Floor {floor.floorNumber}</span>
            <span className="text-xs text-muted-foreground">{floor.rooms.length} rooms</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => addRoom(floor.floorNumber)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Room
            </Button>
            <Button size="icon" variant="ghost" onClick={() => removeFloor(floor.floorNumber)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>

          <div className="space-y-2">
            {floor.rooms.length === 0 && (
              <div className="rounded-md bg-muted/40 p-2 text-center text-xs text-muted-foreground">No rooms on this floor</div>
            )}
            {floor.rooms.map((room) => (
              <div key={room.id} className="rounded-md border border-border/60 bg-background/40 p-2">
                <div className="grid grid-cols-12 gap-2">
                  <Input
                    className="col-span-4 h-8"
                    value={room.name}
                    onChange={(e) => updateRoom(floor.floorNumber, room.id, { name: e.target.value })}
                  />
                  <Input
                    className="col-span-2 h-8"
                    type="number"
                    value={room.capacity}
                    onChange={(e) => updateRoom(floor.floorNumber, room.id, { capacity: Number(e.target.value) })}
                  />
                  <select
                    className="col-span-3 h-8 rounded-md border border-border bg-background px-2 text-xs"
                    value={room.roomType}
                    onChange={(e) => updateRoom(floor.floorNumber, room.id, { roomType: e.target.value })}
                  >
                    {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Button size="sm" variant="outline" className="col-span-2 h-8 text-[10px]" onClick={() => toggleExpand(room.id)}>
                    {expandedRoomId === room.id ? "Hide Eqp" : "Edit Eqp"}
                  </Button>
                  <Button size="icon" variant="ghost" className="col-span-1 h-8 w-8" onClick={() => removeRoom(floor.floorNumber, room.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                {expandedRoomId === room.id && (
                  <div className="mt-2 border-t border-border/50 pt-2 pb-2">
                    <RoomEquipmentEditor
                      equipment={room.equipment}
                      onChange={(eq) => updateRoom(floor.floorNumber, room.id, { equipment: eq })}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
