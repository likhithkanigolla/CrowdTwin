// Calendar-based timetable studio. Opens as a full-screen overlay and shows
// a Mon–Sun × 24h grid. Click an empty cell to add a slot, click an existing
// slot to edit/delete. Slots auto-allocate to rooms by capacity + type.
//
// CSV upload still works (same required columns as before) — parsed entries
// land on the calendar.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CalendarClock, X, Upload, FileDown, Trash2, AlertTriangle, CheckCircle2, Sparkles,
} from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SLOT_HEIGHT = 28; // px per hour
const REQUIRED_COLUMNS = [
  "day", "startTime", "endTime", "courseCode", "faculty", "batch", "expectedStrength", "preferredRoomType",
];
const ROOM_TYPES = ["classroom", "lab", "seminar", "auditorium", "office", "other"];

const toMins = (hhmm) => {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fromMins = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export default function TimetableStudio({ open, onClose, config, store }) {
  const [errors, setErrors] = useState([]);
  const [selected, setSelected] = useState(null); // entry being edited
  const entries = config.timetables || [];

  const allRooms = useMemo(() => flattenRooms(config), [config]);

  // Lock body scroll while overlay open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const setEntries = (next) => store.setTimetables(config.id, next);

  const addSlot = (day, startMins) => {
    const e = {
      id: `tt-${Date.now()}`,
      day,
      startTime: fromMins(startMins),
      endTime: fromMins(Math.min(startMins + 60, 24 * 60)),
      courseCode: "NEW",
      faculty: "",
      batch: "",
      expectedStrength: 30,
      preferredRoomType: "classroom",
      allocatedRoomId: null,
      status: "draft",
    };
    setEntries([...entries, e]);
    setSelected(e.id);
  };

  const updateEntry = (id, patch) => setEntries(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const removeEntry = (id) => { setEntries(entries.filter((e) => e.id !== id)); setSelected(null); };

  const runAllocation = () => setEntries(allocate(entries, allRooms));

  const handleCsv = async (file) => {
    try {
      const raw = await file.text();
      const { headers, rows } = parseCsv(raw);

      const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
      if (missing.length) {
        setErrors([`Missing required columns: ${missing.join(", ")}`]);
        return;
      }

      const rowErrors = [];
      const parsed = rows.map((row, i) => {
        const entry = {
          day: "Mon",
          startTime: "09:00",
          endTime: "10:00",
          courseCode: "",
          faculty: "",
          batch: "",
          expectedStrength: 30,
          preferredRoomType: "classroom",
          ...row,
        };

        entry.expectedStrength = Number(entry.expectedStrength) || 0;
        if (!entry.day || !entry.startTime || !entry.endTime) {
          rowErrors.push(`Row ${i + 2}: missing day/time`);
        }

        return {
          ...entry,
          id: `tt-${Date.now()}-${i}`,
          status: "draft",
          allocatedRoomId: null,
        };
      });

      setErrors(rowErrors);
      setEntries([...entries, ...parsed]);
    } catch (error) {
      setErrors([error?.message || "Failed to parse CSV"]);
    }
  };

  const exportJson = () => download(`timetable-${config.id}.json`, JSON.stringify(entries, null, 2), "application/json");
  const exportCsv = () => {
    const cols = ["day", "startTime", "endTime", "courseCode", "faculty", "batch", "expectedStrength", "preferredRoomType", "allocatedRoomId", "status"];
    const csv = [cols.join(","), ...entries.map((e) => cols.map((c) => csvCell(e[c])).join(","))].join("\n");
    download(`timetable-${config.id}.csv`, csv, "text/csv");
  };

  const selectedEntry = entries.find((e) => e.id === selected) || null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-gradient-control px-4 py-3">
        <CalendarClock className="h-5 w-5 text-primary" />
        <div>
          <div className="text-sm font-semibold">Timetable Studio</div>
          <div className="text-[11px] text-muted-foreground">
            {config.campusName} · {entries.length} slots · weekly view
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="inline-flex">
            <input type="file" accept=".csv" hidden onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])} />
            <Button asChild size="sm" variant="outline">
              <span><Upload className="mr-1 h-3.5 w-3.5" /> Upload CSV</span>
            </Button>
          </label>
          <Button size="sm" variant="secondary" onClick={runAllocation}>
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Auto-allocate
          </Button>
          <Button size="sm" variant="ghost" onClick={exportJson}><FileDown className="mr-1 h-3.5 w-3.5" /> JSON</Button>
          <Button size="sm" variant="ghost" onClick={exportCsv}><FileDown className="mr-1 h-3.5 w-3.5" /> CSV</Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <div className="flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> CSV issues
          </div>
          <ul className="ml-4 list-disc">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {/* Body: calendar + side editor */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <CalendarGrid
            entries={entries}
            selected={selected}
            onCellClick={addSlot}
            onSlotClick={setSelected}
            allRooms={allRooms}
          />
        </div>

        <aside className="w-[340px] shrink-0 overflow-auto border-l border-border bg-card p-4">
          {selectedEntry ? (
            <SlotEditor
              entry={selectedEntry}
              allRooms={allRooms}
              onChange={(patch) => updateEntry(selectedEntry.id, patch)}
              onDelete={() => removeEntry(selectedEntry.id)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <EmptyEditor />
          )}
        </aside>
      </div>
    </div>,
    document.body
  );
}

function CalendarGrid({ entries, selected, onCellClick, onSlotClick, allRooms }) {
  return (
    <div className="min-w-[900px] p-4">
      <div className="grid" style={{ gridTemplateColumns: `60px repeat(${DAYS.length}, minmax(0, 1fr))` }}>
        {/* header row */}
        <div />
        {DAYS.map((d) => (
          <div key={d} className="border-b border-border px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}

        {/* time + day columns */}
        <div>
          {HOURS.map((h) => (
            <div
              key={h}
              className="ct-mono border-b border-border/40 pr-2 text-right text-[10px] text-muted-foreground"
              style={{ height: SLOT_HEIGHT }}
            >
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {DAYS.map((day) => (
          <div key={day} className="relative border-l border-border/60">
            {HOURS.map((h) => (
              <div
                key={h}
                className="border-b border-border/30 hover:bg-primary/5"
                style={{ height: SLOT_HEIGHT }}
                onClick={() => onCellClick(day, h * 60)}
                title={`Add slot ${day} ${String(h).padStart(2, "0")}:00`}
              />
            ))}
            {/* overlaid slots */}
            {entries.filter((e) => e.day === day).map((e) => {
              const top = (toMins(e.startTime) / 60) * SLOT_HEIGHT;
              const height = Math.max(SLOT_HEIGHT * 0.6, ((toMins(e.endTime) - toMins(e.startTime)) / 60) * SLOT_HEIGHT);
              const room = allRooms.find((r) => r.id === e.allocatedRoomId);
              const isSel = selected === e.id;
              const tone = e.status === "conflict" ? "bg-destructive/30 border-destructive/60" :
                           e.status === "allocated" ? "bg-primary/25 border-primary/60" :
                           "bg-accent/25 border-accent/60";
              return (
                <button
                  key={e.id}
                  onClick={(ev) => { ev.stopPropagation(); onSlotClick(e.id); }}
                  className={`absolute left-1 right-1 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight transition ${tone} ${isSel ? "ring-2 ring-primary" : ""}`}
                  style={{ top, height }}
                >
                  <div className="truncate font-semibold">{e.courseCode || "untitled"}</div>
                  <div className="ct-mono truncate text-[10px] opacity-80">{e.startTime}–{e.endTime}</div>
                  {room && <div className="truncate text-[10px] opacity-80">{room.name}</div>}
                  {e.status === "conflict" && <div className="text-[10px] text-destructive">conflict</div>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotEditor({ entry, allRooms, onChange, onDelete, onClose }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Edit slot</h3>
        <StatusBadge status={entry.status} />
        <Button size="icon" variant="ghost" className="ml-auto" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      <Field label="Course code">
        <Input value={entry.courseCode} onChange={(e) => onChange({ courseCode: e.target.value })} />
      </Field>
      <Field label="Faculty">
        <Input value={entry.faculty || ""} onChange={(e) => onChange({ faculty: e.target.value })} />
      </Field>
      <Field label="Batch">
        <Input value={entry.batch || ""} onChange={(e) => onChange({ batch: e.target.value })} />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Day">
          <select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={entry.day} onChange={(e) => onChange({ day: e.target.value })}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Start">
          <Input type="time" value={entry.startTime} onChange={(e) => onChange({ startTime: e.target.value })} />
        </Field>
        <Field label="End">
          <Input type="time" value={entry.endTime} onChange={(e) => onChange({ endTime: e.target.value })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Strength">
          <Input type="number" value={entry.expectedStrength} onChange={(e) => onChange({ expectedStrength: Number(e.target.value) })} />
        </Field>
        <Field label="Room type">
          <select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={entry.preferredRoomType} onChange={(e) => onChange({ preferredRoomType: e.target.value })}>
            {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Allocated room">
        <select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={entry.allocatedRoomId || ""}
                onChange={(e) => onChange({ allocatedRoomId: e.target.value || null, status: e.target.value ? "allocated" : "draft" })}>
          <option value="">— none —</option>
          {allRooms.map((r) => <option key={r.id} value={r.id}>{r.name} (cap {r.capacity}, {r.roomType})</option>)}
        </select>
      </Field>

      <div className="flex items-center gap-2 pt-2">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete slot
        </Button>
      </div>
    </div>
  );
}

function EmptyEditor() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-xs text-muted-foreground">
      <CalendarClock className="mb-2 h-8 w-8 opacity-40" />
      <div className="font-semibold text-foreground">No slot selected</div>
      <p className="mt-1 max-w-[220px]">
        Click an empty cell on the calendar to add a slot, or click an existing slot to edit it.
        Use <strong>Auto-allocate</strong> to assign rooms by capacity & type.
      </p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === "allocated") return <span className="ct-chip border-status-green/40 text-status-green"><CheckCircle2 className="h-3 w-3" /> allocated</span>;
  if (status === "conflict") return <span className="ct-chip border-status-red/40 text-status-red"><AlertTriangle className="h-3 w-3" /> conflict</span>;
  return <span className="ct-chip text-muted-foreground">draft</span>;
}

function flattenRooms(cfg) {
  return (cfg.buildings || []).flatMap((b) =>
    (b.floors || []).flatMap((f) => (f.rooms || []).map((r) => ({ ...r, buildingId: b.id })))
  );
}

function normalizeRoomType(value) {
  const rt = String(value || "").toLowerCase();
  if (!rt) return "classroom";
  if (rt === "lecture" || rt === "tutorial" || rt === "classroom") return "classroom";
  if (rt.includes("lab")) return "lab";
  if (rt.includes("seminar")) return "seminar";
  if (rt.includes("auditorium") || rt.includes("arena")) return "auditorium";
  if (rt.includes("office")) return "office";
  return rt;
}

function allocate(entries, rooms) {
  // Per-room timeline; prefer exact matches but gracefully fallback to any free room.
  const timeline = new Map(); // roomId -> [{day,start,end}]
  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const isFree = (roomId, day, start, end) => {
    const lst = timeline.get(roomId) || [];
    return !lst.some((s) => s.day === day && !(end <= s.start || start >= s.end));
  };
  const reserve = (roomId, day, start, end) => {
    const lst = timeline.get(roomId) || [];
    lst.push({ day, start, end });
    timeline.set(roomId, lst);
  };
  return entries.map((e) => {
    const start = toMins(e.startTime), end = toMins(e.endTime);

    // If a slot already has a room and that room is free, keep it.
    if (e.allocatedRoomId && roomsById.has(e.allocatedRoomId) && isFree(e.allocatedRoomId, e.day, start, end)) {
      reserve(e.allocatedRoomId, e.day, start, end);
      return { ...e, status: "allocated" };
    }

    const needed = Number(e.expectedStrength) || 0;
    const wantedType = normalizeRoomType(e.preferredRoomType);
    const exactType = rooms.filter((r) => normalizeRoomType(r.roomType) === wantedType);
    const otherTypes = rooms.filter((r) => normalizeRoomType(r.roomType) !== wantedType);

    // Candidate pools in order of preference.
    const pools = [
      exactType.filter((r) => Number(r.capacity) >= needed),
      otherTypes.filter((r) => Number(r.capacity) >= needed),
      exactType,
      otherTypes,
    ];

    const seen = new Set();
    const cands = [];
    for (const pool of pools) {
      const sorted = [...pool].sort((a, b) => (Number(a.capacity) || 0) - (Number(b.capacity) || 0));
      for (const room of sorted) {
        if (!seen.has(room.id)) {
          seen.add(room.id);
          cands.push(room);
        }
      }
    }

    for (const r of cands) {
      if (isFree(r.id, e.day, start, end)) {
        reserve(r.id, e.day, start, end);
        return {
          ...e,
          allocatedRoomId: r.id,
          preferredRoomType: normalizeRoomType(r.roomType),
          status: "allocated",
        };
      }
    }

    return { ...e, allocatedRoomId: null, status: "conflict" };
  });
}

function parseCsv(text) {
  const content = String(text || "").trim();
  if (!content) {
    return { headers: [], rows: [] };
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const splitLine = (line) => {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = "";
        continue;
      }

      current += ch;
    }

    values.push(current.trim());
    return values;
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = splitLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? "";
    });
    return row;
  });

  return { headers, rows };
}

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
