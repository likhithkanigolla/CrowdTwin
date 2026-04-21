import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, DoorOpen, DoorClosed, Route, Monitor } from "lucide-react";
import { deriveRoadStatus } from "@/utils/geo";

const TESTS = [
  { key: "mikeSystems", label: "Mike Systems" },
  { key: "projectors", label: "Projectors" },
  { key: "streaming", label: "Streaming" },
];

const RESULT_LABEL = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
};

function getVirtualState(config) {
  const state = config?.virtualActuation || {};
  return {
    classroomTests: state.classroomTests || {},
    professors: Array.isArray(state.professors) ? state.professors : [],
    gateSimulation: {
      profile: state?.gateSimulation?.profile || "lecture_change",
      lastRunAt: state?.gateSimulation?.lastRunAt || null,
    },
    routeProfile: state.routeProfile || "normal",
    controlPanel: {
      operatorName: state?.controlPanel?.operatorName || "Campus Operator",
      autoSyncDisplays: state?.controlPanel?.autoSyncDisplays !== false,
      updatedAt: state?.controlPanel?.updatedAt || null,
    },
  };
}

function isoNow() {
  return new Date().toISOString();
}

export default function VirtualActuationPanel({ config, store, audit }) {
  const [selectedRoomId, setSelectedRoomId] = useState("all");
  const [uploadError, setUploadError] = useState("");
  const virtual = getVirtualState(config);

  const classrooms = useMemo(() => {
    const result = [];
    for (const building of config.buildings || []) {
      for (const floor of building.floors || []) {
        for (const room of floor.rooms || []) {
          if (["classroom", "seminar", "auditorium", "lab"].includes(room.roomType)) {
            result.push({
              id: room.id,
              label: `${building.name} / F${floor.floorNumber} / ${room.name}`,
            });
          }
        }
      }
    }
    return result;
  }, [config.buildings]);

  const updateVirtual = (patch, action = "virtual.update") => {
    const next = {
      ...virtual,
      ...patch,
      controlPanel: {
        ...virtual.controlPanel,
        ...(patch.controlPanel || {}),
        updatedAt: isoNow(),
      },
    };

    store.patchConfig(config.id, { virtualActuation: next });
    audit.log({ action, target: config.id, after: patch });
  };

  const setTestResult = (testKey, result) => {
    const applyTo = selectedRoomId === "all" ? classrooms.map((room) => room.id) : [selectedRoomId];
    const nextTests = { ...virtual.classroomTests };

    applyTo.forEach((roomId) => {
      nextTests[roomId] = {
        ...(nextTests[roomId] || {}),
        [testKey]: result,
      };
    });

    updateVirtual({ classroomTests: nextTests }, "classroom.test.update");
  };

  const testSummary = useMemo(() => {
    const summary = { pending: 0, pass: 0, fail: 0 };
    const roomIds = classrooms.map((room) => room.id);

    for (const roomId of roomIds) {
      const testState = virtual.classroomTests[roomId] || {};
      for (const test of TESTS) {
        const outcome = testState[test.key] || "pending";
        summary[outcome] += 1;
      }
    }

    return summary;
  }, [classrooms, virtual.classroomTests]);

  const applyGateState = (mode) => {
    const nextGates = config.gates.map((gate) => {
      const next = {
        ...gate,
        sideAStatus: mode === "open" ? "open" : "closed",
        sideBStatus: mode === "open" ? "open" : "closed",
      };
      return {
        ...next,
        derivedRoadStatus: deriveRoadStatus(next),
      };
    });

    store.patchConfig(config.id, { gates: nextGates });
    audit.log({ action: `gate.virtual.${mode}`, target: config.id, after: { gateCount: nextGates.length } });
  };

  const runGateSimulation = () => {
    const profile = virtual.gateSimulation.profile;
    const nextGates = config.gates.map((gate, index) => {
      let sideAStatus = "open";
      let sideBStatus = "open";

      if (profile === "lecture_change") {
        sideAStatus = index % 2 === 0 ? "open" : "closed";
        sideBStatus = "open";
      } else if (profile === "peak_exit") {
        sideAStatus = "open";
        sideBStatus = index % 3 === 0 ? "closed" : "open";
      } else if (profile === "emergency") {
        sideAStatus = "open";
        sideBStatus = "open";
      }

      const next = { ...gate, sideAStatus, sideBStatus };
      return {
        ...next,
        derivedRoadStatus: deriveRoadStatus(next),
      };
    });

    store.patchConfig(config.id, { gates: nextGates });
    updateVirtual(
      {
        gateSimulation: {
          ...virtual.gateSimulation,
          lastRunAt: isoNow(),
        },
      },
      "gate.simulation.run"
    );
  };

  const applyRouteProfile = (profile) => {
    const routeMessages = {
      normal: "Normal flow active",
      diversion: "Diversion enabled: follow blue route",
      emergency: "Emergency route active: move to nearest safe gate",
    };

    const nextDisplays = config.displays.map((display) => ({
      ...display,
      routeMode: profile,
      activeMessage: routeMessages[profile],
    }));

    store.patchConfig(config.id, { displays: nextDisplays });
    updateVirtual({ routeProfile: profile }, "route.profile.apply");
  };

  const onProfessorUpload = async (file) => {
    if (!file) return;

    setUploadError("");

    try {
      const text = await file.text();
      let list = [];

      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);
        list = Array.isArray(parsed) ? parsed : [];
      } else {
        const rows = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        if (rows.length > 0) {
          const headers = rows[0].split(",").map((h) => h.trim().toLowerCase());
          list = rows.slice(1).map((row) => {
            const cols = row.split(",").map((c) => c.trim());
            const rowObj = {};
            headers.forEach((header, idx) => {
              rowObj[header] = cols[idx] || "";
            });
            return rowObj;
          });
        }
      }

      const normalized = list
        .map((item, idx) => ({
          id: String(item.id || `prof-${Date.now()}-${idx}`),
          name: String(item.name || item.professor || "").trim(),
          course: String(item.course || item.subject || "").trim(),
          room: String(item.room || item.classroom || "").trim(),
        }))
        .filter((item) => item.name);

      updateVirtual({ professors: normalized }, "professors.upload");
    } catch (error) {
      setUploadError(error?.message || "Upload parsing failed");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Monitor className="h-4 w-4 text-primary" /> Web Interface Control Panel
      </div>

      <div className="ct-panel grid grid-cols-3 gap-2 p-3 text-center text-xs">
        <SummaryChip label="Pass" count={testSummary.pass} cls="ct-status-green" />
        <SummaryChip label="Pending" count={testSummary.pending} cls="ct-status-yellow" />
        <SummaryChip label="Fail" count={testSummary.fail} cls="ct-status-red" />
      </div>

      <div className="ct-panel space-y-2 p-3">
        <Label className="text-xs">Control panel settings</Label>
        <div className="grid grid-cols-12 items-center gap-2">
          <div className="col-span-7">
            <Label className="text-[10px] uppercase text-muted-foreground">Operator</Label>
            <Input
              className="h-8"
              value={virtual.controlPanel.operatorName}
              onChange={(e) => updateVirtual({ controlPanel: { operatorName: e.target.value } }, "control.operator.update")}
            />
          </div>
          <div className="col-span-5 flex items-end gap-2">
            <Button
              size="sm"
              variant={virtual.controlPanel.autoSyncDisplays ? "secondary" : "outline"}
              className="h-8 w-full"
              onClick={() => updateVirtual({ controlPanel: { autoSyncDisplays: !virtual.controlPanel.autoSyncDisplays } }, "control.autosync.toggle")}
            >
              Auto sync displays: {virtual.controlPanel.autoSyncDisplays ? "On" : "Off"}
            </Button>
          </div>
        </div>
      </div>

      <div className="ct-panel space-y-2 p-3">
        <Label className="text-xs">Classroom Control · Software Service Testing</Label>
        <select
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
          value={selectedRoomId}
          onChange={(e) => setSelectedRoomId(e.target.value)}
        >
          <option value="all">All classrooms</option>
          {classrooms.map((room) => (
            <option key={room.id} value={room.id}>{room.label}</option>
          ))}
        </select>

        {TESTS.map((test) => (
          <div key={test.key} className="rounded-md border border-border/60 bg-background/30 p-2">
            <div className="mb-1 text-xs font-medium">{test.label}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setTestResult(test.key, "pass")}>Mark Pass</Button>
              <Button size="sm" variant="outline" onClick={() => setTestResult(test.key, "fail")}>Mark Fail</Button>
              <Button size="sm" variant="ghost" onClick={() => setTestResult(test.key, "pending")}>Reset</Button>
            </div>
          </div>
        ))}

        {classrooms.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
            No classroom rooms configured yet. Add rooms in the Buildings panel to run virtual tests.
          </div>
        )}
      </div>

      <div className="ct-panel space-y-2 p-3">
        <Label className="text-xs">Professors · Upload</Label>
        <label className="inline-flex">
          <input
            type="file"
            accept=".csv,.json"
            hidden
            onChange={(e) => onProfessorUpload(e.target.files?.[0])}
          />
          <Button asChild size="sm" variant="outline">
            <span><Upload className="mr-1 h-3.5 w-3.5" /> Upload CSV/JSON</span>
          </Button>
        </label>
        {uploadError && <div className="text-xs text-destructive">{uploadError}</div>}
        <div className="max-h-40 space-y-1 overflow-auto pr-1">
          {virtual.professors.map((prof) => (
            <div key={prof.id} className="rounded-md border border-border/60 bg-background/30 px-2 py-1.5 text-xs">
              <div className="font-medium">{prof.name}</div>
              <div className="text-muted-foreground">{prof.course || "No course"} · {prof.room || "No room"}</div>
            </div>
          ))}
          {virtual.professors.length === 0 && (
            <div className="text-xs text-muted-foreground">No professors uploaded yet.</div>
          )}
        </div>
      </div>

      <div className="ct-panel space-y-2 p-3">
        <Label className="text-xs">Gate Control · Gate Visualization</Label>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => applyGateState("open")}>
            <DoorOpen className="mr-1 h-3.5 w-3.5" /> Open all
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyGateState("closed")}>
            <DoorClosed className="mr-1 h-3.5 w-3.5" /> Close all
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Simulation profile</Label>
            <select
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              value={virtual.gateSimulation.profile}
              onChange={(e) => updateVirtual({ gateSimulation: { ...virtual.gateSimulation, profile: e.target.value } }, "gate.simulation.profile")}
            >
              <option value="lecture_change">Lecture change</option>
              <option value="peak_exit">Peak exit</option>
              <option value="emergency">Emergency</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button size="sm" className="h-8 w-full" onClick={runGateSimulation}>Run virtual simulation</Button>
          </div>
        </div>

        <div className="space-y-1">
          {config.gates.map((gate) => (
            <div key={gate.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-background/30 px-2 py-1.5 text-xs">
              <span className={`ct-status-dot ct-status-${gate.derivedRoadStatus}`} />
              <span className="truncate">{gate.name}</span>
              <span className="ml-auto text-muted-foreground">A:{gate.sideAStatus} B:{gate.sideBStatus}</span>
            </div>
          ))}
          {config.gates.length === 0 && (
            <div className="text-xs text-muted-foreground">No gates configured yet.</div>
          )}
        </div>
      </div>

      <div className="ct-panel space-y-2 p-3">
        <Label className="text-xs">Route Control</Label>
        <div className="flex flex-wrap gap-2">
          {[
            { key: "normal", label: "Normal" },
            { key: "diversion", label: "Diversion" },
            { key: "emergency", label: "Emergency" },
          ].map((route) => (
            <Button
              key={route.key}
              size="sm"
              variant={virtual.routeProfile === route.key ? "secondary" : "outline"}
              onClick={() => applyRouteProfile(route.key)}
            >
              <Route className="mr-1 h-3.5 w-3.5" /> {route.label}
            </Button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          Active profile: <span className="font-medium text-foreground">{virtual.routeProfile}</span> · {config.displays.length} display(s)
        </div>
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
