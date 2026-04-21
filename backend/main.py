from fastapi import FastAPI, HTTPException, File, UploadFile, WebSocket, WebSocketDisconnect
from typing import List, Optional, Dict, Any
import asyncio
import os
import csv
import json
import random
import subprocess
import sys
import time
from io import StringIO
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

from schemas import (
    Event,
    EventRequest,
    CongestionWithEventsRequest,
    ActuationRequest,
    CameraData,
    CameraFeedUpdate,
    BuildingOccupancyUpdate,
    RoadStatus,
    RoadControlCommand,
    ClassroomRequirement,
    ActuationRule,
    SimulationScheduleEntry,
    SimulationConfig,
    PedSimStateUpdate,
    PedSimSceneFromMapRequest,
    PedSimRuntimeStartRequest,
    UserRole,
    SiteCreate,
    BuildingCreate,
    RoomCreate,
    RoomFacilitiesUpsertRequest,
    EventTypeCreate,
    EventProfileCreate,
    BookingCreate,
    OccupancySignalCreate,
    AllocationRunRequest,
    ManualOverrideRequest,
)
from logic import (
    ai_suggest_building,
    fallback_dynamic_suggestion,
    build_movement_plan_from_csv,
    aggregate_category_counts,
    aggregate_category_counts_with_events,
    build_congestion_response,
    run_actuation_graph,
    MOVEMENT_GROUPS,
    _normalize_csv_row,
    _build_movements_for_row,
    infer_building_category,
)
from allocation_engine import (
    sites_store,
    buildings_store,
    rooms_store,
    facility_types_store,
    event_types_store,
    event_profiles_store,
    bookings_store,
    booking_rooms_store,
    occupancy_signals_store,
    create_site,
    create_building,
    create_room,
    upsert_room_facilities,
    create_event_type,
    create_event_profile,
    create_booking,
    create_occupancy_signal,
    run_allocation,
    get_allocation_run,
    manual_override,
    seed_default_data,
)

app = FastAPI(title="Digital Twin Backend")


class PedSimStreamManager:
    def __init__(self):
        self.connections: Dict[int, Dict[str, Any]] = {}
        self.target_fps = min(120.0, max(5.0, float(os.getenv("PEDSIM_WS_TARGET_FPS", "60"))))
        self.flush_interval_seconds = 1.0 / self.target_fps
        self.keepalive_seconds = max(1.0, float(os.getenv("PEDSIM_WS_KEEPALIVE_SECONDS", "8.0")))
        self.metrics: Dict[str, int] = {
            "ingress_frames": 0,
            "enqueued_frames": 0,
            "sent_frames": 0,
            "dropped_overwrites": 0,
            "failed_sends": 0,
        }

    def _disconnect_by_id(self, connection_id: int):
        connection = self.connections.pop(connection_id, None)
        if not connection:
            return

        sender_task = connection.get("sender_task")
        if sender_task and not sender_task.done():
            sender_task.cancel()

    async def _sender_loop(self, connection_id: int):
        while True:
            await asyncio.sleep(self.flush_interval_seconds)

            connection = self.connections.get(connection_id)
            if not connection:
                return

            websocket = connection.get("websocket")
            payload = connection.get("latest_payload")
            now = time.time()

            try:
                if payload is not None:
                    await websocket.send_json(payload)
                    connection["latest_payload"] = None
                    connection["last_sent_at"] = now
                    connection["sent_frames"] = int(connection.get("sent_frames", 0)) + 1
                    self.metrics["sent_frames"] += 1
                elif now - float(connection.get("last_sent_at", 0.0)) >= self.keepalive_seconds:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "timestamp": datetime.now().isoformat(),
                    })
                    connection["last_sent_at"] = now
            except Exception:
                self.metrics["failed_sends"] += 1
                self._disconnect_by_id(connection_id)
                return

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        connection_id = id(websocket)
        sender_task = asyncio.create_task(self._sender_loop(connection_id))
        self.connections[connection_id] = {
            "websocket": websocket,
            "latest_payload": None,
            "sender_task": sender_task,
            "last_sent_at": time.time(),
            "sent_frames": 0,
            "dropped_overwrites": 0,
        }
        return connection_id

    def disconnect(self, websocket: WebSocket):
        connection_id = next(
            (
                current_id
                for current_id, connection in self.connections.items()
                if connection.get("websocket") is websocket
            ),
            None,
        )
        if connection_id is not None:
            self._disconnect_by_id(connection_id)

    def queue_for_connection(self, connection_id: int, payload: Dict[str, Any]):
        connection = self.connections.get(connection_id)
        if not connection:
            return

        if connection.get("latest_payload") is not None:
            connection["dropped_overwrites"] = int(connection.get("dropped_overwrites", 0)) + 1
            self.metrics["dropped_overwrites"] += 1

        connection["latest_payload"] = payload
        self.metrics["enqueued_frames"] += 1

    def broadcast(self, payload: Dict[str, Any]):
        self.metrics["ingress_frames"] += 1
        for connection_id in self.connections.keys():
            self.queue_for_connection(connection_id, payload)

    def close(self):
        while self.connections:
            connection_id = next(iter(self.connections.keys()))
            self._disconnect_by_id(connection_id)

    def status(self) -> Dict[str, Any]:
        connection_stats = []
        for connection in self.connections.values():
            connection_stats.append({
                "sent_frames": int(connection.get("sent_frames", 0)),
                "dropped_overwrites": int(connection.get("dropped_overwrites", 0)),
            })

        return {
            "connections": len(self.connections),
            "target_fps": self.target_fps,
            "flush_interval_ms": round(self.flush_interval_seconds * 1000.0, 2),
            **self.metrics,
            "connection_stats": connection_stats,
        }


pedsim_stream_manager = PedSimStreamManager()

events_db = []

# Module-level schedule store
current_schedule: Optional[Dict[str, Any]] = None

# ==================== NEW STATE STORES ====================
# Camera data store - tracks live camera readings
camera_data_store: Dict[str, CameraData] = {}

# Building occupancy from sensors
building_occupancy_store: Dict[str, BuildingOccupancyUpdate] = {}

# Road control state
road_status_store: Dict[str, Dict[str, Any]] = {}

# Classroom requirements
classroom_requirements_store: Dict[str, ClassroomRequirement] = {}

# Actuation rules
actuation_rules_store: Dict[str, ActuationRule] = {}

# Simulation configurations
simulation_configs_store: Dict[str, SimulationConfig] = {}

# PedSim latest state frame
pedsim_state_store: Dict[str, Any] = {
    "stream_id": datetime.now().isoformat(),
    "sim_time": None,
    "timestamp": None,
    "stream_sequence": 0,
    "agents": [],
    "metadata": {},
}

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(BACKEND_DIR)

# Create uploads directory if it doesn't exist
UPLOADS_DIR = os.path.join(BACKEND_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
PEDSIM_TRANSFORM_PATH = os.path.join(UPLOADS_DIR, "pedsim_scene_transform.json")
PEDSIM_SCENE_EXPORT_PATH = os.path.join(UPLOADS_DIR, "pedsim_scene_from_map.xml")
PEDSIM_SPAWN_GROUPS_PATH = os.path.join(UPLOADS_DIR, "pedsim_spawn_groups.json")
PEDSIM_DEMOAPP_SCENE_PATH = os.path.join(REPO_ROOT, "pedsim", "ecosystem", "demoapp", "scene.xml")

pedsim_scene_transform_store: Dict[str, Any] = {
    "origin_lng": 78.3487,
    "origin_lat": 17.4464,
    "scale": 0.00003,
    "updated_at": None,
    "boundary_source": None,
    "scene_file": PEDSIM_SCENE_EXPORT_PATH,
    "demoapp_scene_file": PEDSIM_DEMOAPP_SCENE_PATH,
}
pedsim_last_scene_request_store: Optional[Dict[str, Any]] = None


class PedSimRuntimeManager:
    """Owns the local PedSim demoapp and bridge subprocess lifecycle."""

    def __init__(self):
        self.bridge_process: Optional[subprocess.Popen] = None
        self.demoapp_process: Optional[subprocess.Popen] = None
        self.listen_port: int = int(os.getenv("PEDSIM_LISTEN_PORT", "2222"))
        self.backend_url: str = os.getenv("PEDSIM_BACKEND_URL", f"http://127.0.0.1:{os.getenv('PORT', '8904')}")
        self.scene_file: Optional[str] = None
        self.started_at: Optional[str] = None
        self.external_bridge_owner: Optional[Dict[str, Any]] = None

    @staticmethod
    def _process_snapshot(process: Optional[subprocess.Popen]) -> Dict[str, Any]:
        if not process:
            return {"running": False, "pid": None, "return_code": None}

        return {
            "running": process.poll() is None,
            "pid": process.pid,
            "return_code": process.poll(),
        }

    @staticmethod
    def _resolve_demoapp_binary() -> Optional[str]:
        candidates = [
            os.path.join(REPO_ROOT, "pedsim", "ecosystem", "demoapp", "pedsim.app", "Contents", "MacOS", "pedsim"),
            os.path.join(REPO_ROOT, "pedsim", "ecosystem", "demoapp", "pedsim"),
        ]

        for candidate in candidates:
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate

        return None

    @staticmethod
    def _read_process_command(pid: int) -> Optional[str]:
        try:
            result = subprocess.run(
                ["ps", "-p", str(pid), "-o", "command="],
                capture_output=True,
                text=True,
                check=False,
            )
            command = (result.stdout or "").strip()
            return command or None
        except Exception:
            return None

    @classmethod
    def _detect_udp_port_owners(cls, port: int) -> List[Dict[str, Any]]:
        try:
            result = subprocess.run(
                ["lsof", "-nP", f"-iUDP:{port}"],
                capture_output=True,
                text=True,
                check=False,
            )
        except Exception:
            return []

        if not result.stdout:
            return []

        lines = [line for line in result.stdout.splitlines() if line.strip()]
        if len(lines) <= 1:
            return []

        owners: List[Dict[str, Any]] = []
        for line in lines[1:]:
            parts = line.split()
            if len(parts) < 2:
                continue

            pid: Optional[int] = None
            try:
                pid = int(parts[1])
            except (TypeError, ValueError):
                pid = None

            owner = {
                "command": parts[0],
                "pid": pid,
                "command_line": cls._read_process_command(pid) if pid is not None else None,
            }
            owners.append(owner)

        return owners

    @staticmethod
    def _is_bridge_owner(owner: Dict[str, Any]) -> bool:
        command_line = str(owner.get("command_line") or "").lower()
        return "pedsim_bridge.py" in command_line or "pedsim_bridge" in command_line

    def _bridge_status_snapshot(self) -> Dict[str, Any]:
        managed = self._process_snapshot(self.bridge_process)
        owners = self._detect_udp_port_owners(self.listen_port)
        external_bridge_owner = next((owner for owner in owners if self._is_bridge_owner(owner)), None)

        if not managed["running"]:
            self.external_bridge_owner = external_bridge_owner

        effective_owner = None
        if managed["running"]:
            effective_owner = {
                "pid": managed["pid"],
                "command": "python",
                "command_line": "managed-by-backend",
            }
        elif external_bridge_owner:
            effective_owner = external_bridge_owner

        return {
            "running": bool(managed["running"] or external_bridge_owner),
            "managed": bool(managed["running"]),
            "external": bool(external_bridge_owner),
            "pid": managed["pid"] if managed["running"] else (external_bridge_owner or {}).get("pid"),
            "return_code": managed["return_code"],
            "owner": effective_owner,
            "udp_port_in_use": len(owners) > 0,
            "udp_port_owners": owners,
        }

    def _cleanup_finished(self):
        if self.bridge_process and self.bridge_process.poll() is not None:
            self.bridge_process = None
        if self.demoapp_process and self.demoapp_process.poll() is not None:
            self.demoapp_process = None

        if not self.bridge_process and not self.demoapp_process:
            self.started_at = None

    @staticmethod
    def _stop_process(process: Optional[subprocess.Popen], timeout_seconds: float = 3.0):
        if not process or process.poll() is not None:
            return

        process.terminate()
        try:
            process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=timeout_seconds)

    def status(self) -> Dict[str, Any]:
        self._cleanup_finished()
        bridge = self._bridge_status_snapshot()
        demoapp = self._process_snapshot(self.demoapp_process)
        return {
            "running": bridge["running"] and demoapp["running"],
            "bridge": bridge,
            "demoapp": demoapp,
            "listen_port": self.listen_port,
            "backend_url": self.backend_url,
            "scene_file": self.scene_file,
            "started_at": self.started_at,
        }

    def stop(self) -> Dict[str, Any]:
        self._stop_process(self.demoapp_process)
        self._stop_process(self.bridge_process)
        self.demoapp_process = None
        self.bridge_process = None
        self.started_at = None
        self.external_bridge_owner = None
        return self.status()

    def _has_running_runtime(self) -> bool:
        bridge = self._bridge_status_snapshot()
        demoapp_running = bool(self.demoapp_process and self.demoapp_process.poll() is None)
        return bool(bridge["running"] and demoapp_running)

    def _resolve_start_inputs(
        self,
        scene_file: Optional[str],
        listen_port: Optional[int],
        backend_url: Optional[str],
    ) -> tuple[str, str, str, int, str]:
        resolved_scene_file = scene_file or pedsim_scene_transform_store.get("demoapp_scene_file") or PEDSIM_DEMOAPP_SCENE_PATH
        if not os.path.exists(resolved_scene_file):
            raise FileNotFoundError(f"Scene file not found: {resolved_scene_file}")

        demoapp_binary = self._resolve_demoapp_binary()
        if not demoapp_binary:
            raise FileNotFoundError(
                "PedSim demoapp binary not found. Build the demoapp first under pedsim/ecosystem/demoapp."
            )

        bridge_script = os.path.join(BACKEND_DIR, "pedsim_bridge.py")
        if not os.path.exists(bridge_script):
            raise FileNotFoundError(f"PedSim bridge script not found: {bridge_script}")

        resolved_listen_port = int(listen_port or self.listen_port)
        resolved_backend_url = backend_url or self.backend_url
        return resolved_scene_file, demoapp_binary, bridge_script, resolved_listen_port, resolved_backend_url

    def _start_bridge(self, bridge_script: str, listen_port: int, backend_url: str):
        self.bridge_process = subprocess.Popen(
            [
                sys.executable,
                bridge_script,
                "--listen-port",
                str(listen_port),
                "--backend-url",
                backend_url,
            ],
            cwd=BACKEND_DIR,
        )

        time.sleep(0.25)
        if self.bridge_process.poll() is not None:
            raise RuntimeError(
                "PedSim bridge exited immediately. Confirm UDP 2222 is free and backend URL is reachable."
            )

    def _ensure_bridge_available(self, bridge_script: str, listen_port: int, backend_url: str):
        owners = self._detect_udp_port_owners(listen_port)
        if not owners:
            self.external_bridge_owner = None
            self._start_bridge(bridge_script, listen_port, backend_url)
            return

        existing_bridge_owner = next((owner for owner in owners if self._is_bridge_owner(owner)), None)
        if existing_bridge_owner:
            # Reuse an already running external bridge (e.g., started manually).
            self.bridge_process = None
            self.external_bridge_owner = existing_bridge_owner
            return

        owner = owners[0]
        raise RuntimeError(
            f"UDP port {listen_port} is in use by pid={owner.get('pid')} command={owner.get('command')}. "
            "Stop that process or choose a different bridge listen port."
        )

    def _start_demoapp(self, demoapp_binary: str, scene_file: str):
        self.demoapp_process = subprocess.Popen(
            [demoapp_binary, scene_file],
            cwd=os.path.dirname(scene_file),
        )

        time.sleep(0.25)
        if self.demoapp_process.poll() is not None:
            self._stop_process(self.bridge_process)
            self.bridge_process = None
            raise RuntimeError("PedSim demoapp exited immediately. Verify scene XML format and demoapp binary.")

    def start(
        self,
        scene_file: Optional[str] = None,
        listen_port: Optional[int] = None,
        backend_url: Optional[str] = None,
        force_restart: bool = True,
    ) -> Dict[str, Any]:
        self._cleanup_finished()

        if force_restart and (self.bridge_process or self.demoapp_process):
            self.stop()
        elif self._has_running_runtime():
            return self.status()

        (
            resolved_scene_file,
            demoapp_binary,
            bridge_script,
            resolved_listen_port,
            resolved_backend_url,
        ) = self._resolve_start_inputs(scene_file, listen_port, backend_url)

        self.listen_port = resolved_listen_port
        self.backend_url = resolved_backend_url
        self.scene_file = resolved_scene_file

        self._ensure_bridge_available(bridge_script, resolved_listen_port, resolved_backend_url)
        self._start_demoapp(demoapp_binary, resolved_scene_file)

        self.started_at = datetime.now().isoformat()
        return self.status()


pedsim_runtime_manager = PedSimRuntimeManager()


def _load_scene_transform_store():
    if not os.path.exists(PEDSIM_TRANSFORM_PATH):
        return

    try:
        with open(PEDSIM_TRANSFORM_PATH, "r", encoding="utf-8") as transform_file:
            payload = json.load(transform_file)
    except Exception as exc:
        print(f"Could not restore PedSim scene transform: {exc}")
        return

    if isinstance(payload, dict):
        pedsim_scene_transform_store.update(payload)


def _persist_scene_transform_store():
    with open(PEDSIM_TRANSFORM_PATH, "w", encoding="utf-8") as transform_file:
        json.dump(pedsim_scene_transform_store, transform_file, indent=2)


@app.on_event("startup")
def _restore_schedule_on_startup():
    """Restore the last uploaded CSV on backend restart."""
    global current_schedule
    _load_scene_transform_store()
    filepath = os.path.join(UPLOADS_DIR, "current_movement_plan.csv")
    if not os.path.exists(filepath):
        return
    try:
        seed_default_data(force=False)
        with open(filepath, 'r', encoding='utf-8-sig') as f:
            text = f.read()
        plan = _build_movement_plan_from_rows(text)
        cohort_schedule_by_time = {}
        for movement in plan.get("movements", []):
            time_key = movement.get("start_time", "")
            cohort = movement.get("group", "").lower().replace(" ", "_")
            if time_key not in cohort_schedule_by_time:
                cohort_schedule_by_time[time_key] = {}
            cohort_schedule_by_time[time_key][cohort] = {
                "venue": movement.get("venue", ""),
                "from_location": movement.get("from_location", ""),
                "attendees": movement.get("attendees", 0),
                "start_time": movement.get("start_time", ""),
                "end_time": movement.get("end_time", ""),
                "duration_minutes": movement.get("duration_minutes", 0)
            }
        current_schedule = {
            "date": plan.get("row_summaries", [{}])[0].get("date", "") if plan.get("row_summaries") else "",
            "schedule_by_time": cohort_schedule_by_time,
            "movements": plan.get("movements", []),
            "row_summaries": plan.get("row_summaries", [])
        }
        print(f"Restored schedule from {filepath}")
    except Exception as e:
        print(f"Could not restore schedule: {e}")


@app.on_event("shutdown")
def _shutdown_runtime_on_exit():
    """Ensure external PedSim processes are not left behind on server shutdown."""
    try:
        pedsim_runtime_manager.stop()
    except Exception:
        pass
    try:
        pedsim_stream_manager.close()
    except Exception:
        pass

def _build_movement_plan_from_rows(text: str) -> dict:
    """Parse CSV text and build movement plan. Raises HTTPException on errors."""
    reader = csv.DictReader(StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file is missing a header row.")

    normalized_headers = {header.strip() for header in reader.fieldnames if header and header.strip()}
    expected_columns = {"Date", "Start_time", "End_time", "Venue", "Total_Capacity"}
    expected_columns.update({col for _, col, _ in MOVEMENT_GROUPS})
    expected_columns.update({loc for _, _, loc in MOVEMENT_GROUPS})

    missing_columns = expected_columns - normalized_headers
    if missing_columns:
        raise HTTPException(
            status_code=400,
            detail=f"CSV is missing required columns: {', '.join(sorted(missing_columns))}."
        )

    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV file contains no data rows.")

    plan_entries = []
    summaries = []
    for row_idx, raw_row in enumerate(rows, start=1):
        normalized_row = _normalize_csv_row(raw_row)
        try:
            movements, summary = _build_movements_for_row(normalized_row, row_idx)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        plan_entries.extend(movements)
        summaries.append(summary)

    return {
        "imported_rows": len(rows),
        "total_movements": len(plan_entries),
        "movements": plan_entries,
        "row_summaries": summaries,
    }


async def _build_movement_plan_from_csv(file: UploadFile) -> dict:
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded CSV is empty.")

    text = contents.decode("utf-8-sig")
    return _build_movement_plan_from_rows(text)


@app.get("/")
def read_root():
    return {"status": "Digital Twin Backend Running"}


@app.post("/suggest-building")
def suggest_building(req: EventRequest):
    if not req.buildings:
        raise HTTPException(status_code=400, detail="No buildings provided for suggestion")

    ai_result = ai_suggest_building(req)
    if ai_result:
        return ai_result

    return fallback_dynamic_suggestion(req)


@app.post("/events")
def create_event(event: Event):
    events_db.append(dict(event))
    return {"message": "Event created successfully", "event": event}


@app.get("/events")
def get_events():
    return {"events": events_db}


@app.post("/movement-plan")
async def upload_movement_plan(file: UploadFile = File(...)):
    global current_schedule
    
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a CSV.")

    # Read raw contents first so we can both save and parse
    raw_contents = await file.read()
    if not raw_contents:
        raise HTTPException(status_code=400, detail="Uploaded CSV is empty.")

    # Save the uploaded CSV file (replaces previous one)
    filepath = os.path.join(UPLOADS_DIR, "current_movement_plan.csv")
    with open(filepath, 'wb') as f:
        f.write(raw_contents)

    # Re-create a mock UploadFile-like object for the parser using a fresh StringIO
    text = raw_contents.decode("utf-8-sig")
    plan = _build_movement_plan_from_rows(text)
    await file.close()
    
    # Build cohort schedules from movements data
    cohort_schedule_by_time = {}
    
    movements = plan.get("movements", [])
    for movement in movements:
        cohort = movement.get("group", "").lower().replace(" ", "_")
        venue = movement.get("venue", "")
        start_time = movement.get("start_time", "")
        end_time = movement.get("end_time", "")
        from_location = movement.get("from_location", "")
        attendees = movement.get("attendees", 0)
        
        time_key = start_time
        if time_key not in cohort_schedule_by_time:
            cohort_schedule_by_time[time_key] = {}
        
        cohort_schedule_by_time[time_key][cohort] = {
            "venue": venue,
            "from_location": from_location,
            "attendees": attendees,
            "start_time": start_time,
            "end_time": end_time,
            "duration_minutes": movement.get("duration_minutes", 0)
        }
    
    # Store the schedule globally for the frontend to fetch
    current_schedule = {
        "date": plan.get("row_summaries", [{}])[0].get("date", "") if plan.get("row_summaries") else "",
        "schedule_by_time": cohort_schedule_by_time,
        "movements": movements,
        "row_summaries": plan.get("row_summaries", [])
    }
    
    return {
        "imported_rows": plan.get("imported_rows"),
        "total_movements": plan.get("total_movements"),
        "row_summaries": plan.get("row_summaries", []),
        "schedule_by_time": cohort_schedule_by_time,
        "message": "Movement plan uploaded and stored successfully"
    }


@app.get("/schedule")
def get_schedule():
    """Retrieve the current movement schedule for the frontend"""
    if current_schedule is None:
        return {
            "schedule_by_time": {},
            "movements": [],
            "message": "No schedule loaded yet. Upload a CSV first."
        }
    return current_schedule


def _aggregate_from_csv_schedule(sim_time: float) -> dict[str, int]:
    """Calculate category counts from the uploaded CSV schedule instead of hardcoded data."""
    if not current_schedule or not current_schedule.get("schedule_by_time"):
        return {}
    
    schedule_by_time = current_schedule["schedule_by_time"]
    category_counts: dict[str, int] = {}
    
    # Convert sim_time to find applicable schedule slots
    sim_hour = sim_time
    
    for time_key, cohort_data in schedule_by_time.items():
        for cohort_id, slot_info in cohort_data.items():
            start_time = slot_info.get("start_time", "")
            end_time = slot_info.get("end_time", "")
            venue = slot_info.get("venue", "")
            attendees = slot_info.get("attendees", 0)
            
            # Parse start and end times
            try:
                start_parts = start_time.split(":")
                end_parts = end_time.split(":")
                start_hour = int(start_parts[0]) + int(start_parts[1]) / 60
                end_hour = int(end_parts[0]) + int(end_parts[1]) / 60
                
                # Check if current time is within this slot
                if start_hour <= sim_hour < end_hour:
                    # Infer category from venue name
                    category = infer_building_category(venue)
                    category_counts[category] = category_counts.get(category, 0) + attendees
            except (ValueError, IndexError):
                continue
    
    return category_counts


@app.get("/congestion")
def get_congestion(sim_time: float = 8.0):
    hour = int(sim_time)
    
    # Try to use uploaded CSV schedule first
    csv_counts = _aggregate_from_csv_schedule(sim_time)
    if csv_counts:
        category_counts = csv_counts
    else:
        # Fall back to hardcoded schedule
        category_counts = aggregate_category_counts(hour)
    
    return build_congestion_response(sim_time, category_counts)


@app.post("/congestion-with-events")
def get_congestion_with_events(payload: CongestionWithEventsRequest):
    category_counts, applied_events = aggregate_category_counts_with_events(payload.sim_time, payload.events)
    return build_congestion_response(payload.sim_time, category_counts, events_applied=applied_events)


@app.post("/actuation-plan")
def get_actuation_plan(payload: ActuationRequest):
    if payload.max_actions < 1:
        raise HTTPException(status_code=400, detail="max_actions must be >= 1")
    if payload.approval_mode not in ("manual", "auto"):
        raise HTTPException(status_code=400, detail="approval_mode must be 'manual' or 'auto'")

    return run_actuation_graph(payload)


# ==================== VISUALIZATION MODE ENDPOINTS ====================

@app.post("/camera-feed")
def receive_camera_feed(feed: CameraFeedUpdate):
    """
    Receive live camera feed data from sensors.
    Cameras are placed at building entrances and roads.
    """
    timestamp = feed.timestamp or datetime.now().isoformat()
    updated_cameras = []
    
    for camera in feed.cameras:
        camera_data_store[camera.camera_id] = camera
        updated_cameras.append(camera.camera_id)
    
    return {
        "message": "Camera feed received",
        "updated_cameras": updated_cameras,
        "timestamp": timestamp,
        "total_cameras_tracked": len(camera_data_store)
    }


@app.get("/camera-feed")
def get_all_camera_data():
    """Get current data from all cameras"""
    return {
        "cameras": list(camera_data_store.values()),
        "total_cameras": len(camera_data_store)
    }


@app.get("/camera-feed/{camera_id}")
def get_camera_data(camera_id: str):
    """Get data from a specific camera"""
    if camera_id not in camera_data_store:
        raise HTTPException(status_code=404, detail=f"Camera {camera_id} not found")
    return camera_data_store[camera_id]


@app.post("/building-occupancy")
def update_building_occupancy(occupancy: BuildingOccupancyUpdate):
    """Update occupancy data for a building from sensors"""
    building_occupancy_store[occupancy.building_name] = occupancy
    return {
        "message": f"Occupancy updated for {occupancy.building_name}",
        "current_occupancy": occupancy.current_occupancy
    }


@app.get("/building-occupancy")
def get_all_building_occupancy():
    """Get current occupancy data for all buildings"""
    return {
        "buildings": {k: v.dict() for k, v in building_occupancy_store.items()},
        "total_buildings": len(building_occupancy_store)
    }


# ==================== ACTUATION MODE ENDPOINTS ====================

@app.post("/road-control")
def control_road(command: RoadControlCommand):
    """
    Control a road segment status.
    - OPEN: Normal traffic flow
    - SOFT_CLOSED: Closed but can be auto-opened by system if needed
    - HARD_CLOSED: Manually closed (repair work etc), cannot be auto-opened
    """
    if command.status != RoadStatus.OPEN and command.closed_by != UserRole.ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Only admin can apply road closures"
        )

    road_status_store[command.road_id] = {
        "road_id": command.road_id,
        "road_name": command.road_name,
        "status": command.status.value,
        "reason": command.reason,
        "closed_by": command.closed_by.value if command.closed_by else None,
        "updated_at": datetime.now().isoformat()
    }
    
    return {
        "message": f"Road {command.road_id} status updated to {command.status.value}",
        "road_status": road_status_store[command.road_id]
    }


@app.get("/road-control")
def get_all_road_status():
    """Get status of all controlled roads"""
    return {
        "roads": list(road_status_store.values()),
        "total_controlled_roads": len(road_status_store)
    }


@app.delete("/road-control/{road_id}")
def reset_road_status(road_id: str):
    """Reset a road to open status"""
    if road_id in road_status_store:
        del road_status_store[road_id]
    return {"message": f"Road {road_id} reset to default (open)"}


# Store for available roads discovered from map
available_roads_store: List[Dict[str, str]] = []


@app.post("/roads/register")
def register_roads(roads: List[Dict[str, str]]):
    """
    Register available roads from the frontend map.
    This is called by the frontend when roads are loaded from OSM.
    """
    global available_roads_store
    available_roads_store = roads
    return {
        "message": f"Registered {len(roads)} roads",
        "roads": roads
    }


@app.get("/roads")
def get_available_roads():
    """Get all available roads for UI selection"""
    # Combine discovered roads with controlled roads
    all_roads = []
    registered_ids = set()
    
    # Add registered roads
    for road in available_roads_store:
        all_roads.append({
            "road_id": road.get("road_id", road.get("name", "unknown")),
            "road_name": road.get("road_name", road.get("name", "Unknown Road")),
            "road_type": road.get("road_type", road.get("highway", "path")),
            "status": road_status_store.get(road.get("road_id", ""), {}).get("status", "open")
        })
        registered_ids.add(road.get("road_id", road.get("name")))
    
    # Add any roads that have been controlled but weren't registered
    for road_id, status in road_status_store.items():
        if road_id not in registered_ids:
            all_roads.append({
                "road_id": road_id,
                "road_name": status.get("road_name", road_id),
                "road_type": "unknown",
                "status": status.get("status", "open")
            })
    
    return {
        "roads": all_roads,
        "total": len(all_roads)
    }


@app.post("/classroom-requirement")
def add_classroom_requirement(requirement: ClassroomRequirement):
    """Faculty adds requirements for a classroom before class"""
    key = f"{requirement.classroom_id}_{requirement.date}_{requirement.start_time}"
    classroom_requirements_store[key] = requirement
    
    return {
        "message": f"Requirements added for {requirement.classroom_name}",
        "requirement_id": key,
        "actuation_status": "Ready for actuation before class"
    }


@app.get("/classroom-requirements")
def get_all_classroom_requirements():
    """Get all classroom requirements"""
    return {
        "requirements": [r.dict() for r in classroom_requirements_store.values()],
        "total_requirements": len(classroom_requirements_store)
    }


@app.post("/actuation-rule")
def add_actuation_rule(rule: ActuationRule):
    """Add an automatic actuation rule"""
    actuation_rules_store[rule.rule_id] = rule
    return {
        "message": f"Actuation rule '{rule.name}' added",
        "rule": rule.dict()
    }


@app.get("/actuation-rules")
def get_all_actuation_rules():
    """Get all actuation rules"""
    return {
        "rules": [r.dict() for r in actuation_rules_store.values()],
        "total_rules": len(actuation_rules_store)
    }


@app.delete("/actuation-rule/{rule_id}")
def delete_actuation_rule(rule_id: str):
    """Delete an actuation rule"""
    if rule_id in actuation_rules_store:
        del actuation_rules_store[rule_id]
        return {"message": f"Rule {rule_id} deleted"}
    raise HTTPException(status_code=404, detail=f"Rule {rule_id} not found")


@app.post("/evaluate-actuation")
def evaluate_actuation_rules(sim_time: float = 8.0):
    """
    Evaluate all actuation rules against current state
    and return recommended actions
    """
    recommendations = []
    
    # Check road congestion from camera data
    road_cameras = [c for c in camera_data_store.values() if "road" in c.location_name.lower()]
    
    for camera in road_cameras:
        if camera.people_count > 100:  # High congestion threshold
            # Check if road is available for soft-close
            road_id = f"road_{camera.camera_id}"
            current_status = road_status_store.get(road_id, {}).get("status", "open")
            
            if current_status != "hard_closed":
                recommendations.append({
                    "type": "redirect_traffic",
                    "location": camera.location_name,
                    "reason": f"High congestion ({camera.people_count} people)",
                    "suggested_action": "soft_close",
                    "auto_executable": True
                })
    
    # Check actuation rules
    for rule in actuation_rules_store.values():
        if rule.enabled:
            recommendations.append({
                "rule_id": rule.rule_id,
                "rule_name": rule.name,
                "condition": rule.condition,
                "suggested_action": rule.action,
                "auto_executable": rule.auto_execute
            })
    
    return {
        "recommendations": recommendations,
        "total_recommendations": len(recommendations),
        "sim_time": sim_time
    }


# ==================== SIMULATION MODE ENDPOINTS ====================

@app.post("/simulation-config")
def create_simulation_config(config: SimulationConfig):
    """Create a new simulation configuration"""
    simulation_configs_store[config.name] = config
    return {
        "message": f"Simulation '{config.name}' created",
        "config": config.dict()
    }


@app.get("/simulation-configs")
def get_all_simulation_configs():
    """Get all simulation configurations"""
    return {
        "configs": [c.dict() for c in simulation_configs_store.values()],
        "total_configs": len(simulation_configs_store)
    }


@app.get("/simulation-config/{name}")
def get_simulation_config(name: str):
    """Get a specific simulation configuration"""
    if name not in simulation_configs_store:
        raise HTTPException(status_code=404, detail=f"Simulation '{name}' not found")
    return simulation_configs_store[name].dict()


@app.delete("/simulation-config/{name}")
def delete_simulation_config(name: str):
    """Delete a simulation configuration"""
    if name in simulation_configs_store:
        del simulation_configs_store[name]
        return {"message": f"Simulation '{name}' deleted"}
    raise HTTPException(status_code=404, detail=f"Simulation '{name}' not found")


@app.post("/simulation-evaluate")
def evaluate_simulation(config: SimulationConfig):
    """
    Evaluate a simulation scenario.
    Checks if closed roads cause problems and suggests fixes.
    """
    issues = []
    auto_fixes = []
    
    # Check if too many roads are closed
    hard_closed_roads = [
        r for r in config.road_closures 
        if r.status == RoadStatus.HARD_CLOSED
    ]
    soft_closed_roads = [
        r for r in config.road_closures 
        if r.status == RoadStatus.SOFT_CLOSED
    ]
    
    total_people = sum(entry.count for entry in config.schedule)
    
    # If crowd is high and many roads are closed, generate warning
    if total_people > 500 and len(hard_closed_roads) > 2:
        issues.append({
            "type": "congestion_risk",
            "severity": "high",
            "message": f"Too many hard-closed roads ({len(hard_closed_roads)}) with {total_people} people scheduled",
            "affected_roads": [r.road_id for r in hard_closed_roads]
        })
    
    # Auto-fix soft-closed roads if needed
    if total_people > 800 and soft_closed_roads:
        for road in soft_closed_roads:
            auto_fixes.append({
                "action": "auto_open",
                "road_id": road.road_id,
                "reason": f"Opening due to high crowd demand ({total_people} people)"
            })
    
    # Check for impossible scenarios (all routes blocked)
    if len(hard_closed_roads) >= 5:
        issues.append({
            "type": "route_blocked",
            "severity": "critical",
            "message": "Too many roads hard-closed. Some destinations may be unreachable.",
            "suggestion": "Reduce hard-closed roads or provide alternative routes"
        })
    
    return {
        "simulation_name": config.name,
        "total_population": total_people,
        "issues": issues,
        "auto_fixes": auto_fixes,
        "feasible": len([i for i in issues if i["severity"] == "critical"]) == 0
    }


@app.post("/pedsim/state")
async def push_pedsim_state(update: PedSimStateUpdate):
    """Receive latest frame from the external PedSim runtime."""
    pedsim_state_store["stream_sequence"] = int(pedsim_state_store.get("stream_sequence") or 0) + 1
    pedsim_state_store["sim_time"] = update.sim_time
    pedsim_state_store["timestamp"] = update.timestamp or datetime.now().isoformat()
    pedsim_state_store["agents"] = [agent.dict() for agent in update.agents]
    pedsim_state_store["metadata"] = update.metadata or {}

    payload = {
        "type": "frame",
        "stream_id": pedsim_state_store.get("stream_id"),
        "stream_sequence": pedsim_state_store.get("stream_sequence"),
        "sim_time": pedsim_state_store.get("sim_time"),
        "timestamp": pedsim_state_store.get("timestamp"),
        "agents": pedsim_state_store.get("agents", []),
        "metadata": pedsim_state_store.get("metadata", {}),
        "agent_count": len(pedsim_state_store.get("agents", [])),
        "scene_transform": dict(pedsim_scene_transform_store),
    }

    pedsim_stream_manager.broadcast(payload)

    return {
        "message": "PedSim state updated",
        "stream_id": pedsim_state_store.get("stream_id"),
        "stream_sequence": pedsim_state_store.get("stream_sequence"),
        "agent_count": len(pedsim_state_store["agents"]),
        "timestamp": pedsim_state_store["timestamp"],
    }


@app.get("/pedsim/state")
def get_pedsim_state():
    """Return latest PedSim frame for frontend rendering."""
    return {
        "type": "snapshot",
        "stream_id": pedsim_state_store.get("stream_id"),
        "stream_sequence": pedsim_state_store.get("stream_sequence", 0),
        "sim_time": pedsim_state_store.get("sim_time"),
        "timestamp": pedsim_state_store.get("timestamp"),
        "agents": pedsim_state_store.get("agents", []),
        "metadata": pedsim_state_store.get("metadata", {}),
        "agent_count": len(pedsim_state_store.get("agents", [])),
        "scene_transform": dict(pedsim_scene_transform_store),
    }


@app.delete("/pedsim/state")
def clear_pedsim_state():
    """Clear current PedSim frame."""
    pedsim_state_store["sim_time"] = None
    pedsim_state_store["timestamp"] = datetime.now().isoformat()
    pedsim_state_store["agents"] = []
    pedsim_state_store["metadata"] = {}
    return {
        "message": "PedSim state cleared",
        "stream_id": pedsim_state_store.get("stream_id"),
        "stream_sequence": pedsim_state_store.get("stream_sequence", 0),
    }


@app.get("/pedsim/stream/status")
def get_pedsim_stream_status():
    """Report WebSocket stream fanout health and drop metrics."""
    return pedsim_stream_manager.status()


@app.get("/pedsim/runtime/status")
def get_pedsim_runtime_status():
    """Report health and process status for demoapp + bridge."""
    return pedsim_runtime_manager.status()


@app.post("/pedsim/runtime/start")
def start_pedsim_runtime(request: PedSimRuntimeStartRequest):
    """Start (or restart) the PedSim demoapp and UDP bridge."""
    try:
        scene_file = request.scene_file
        runtime_note = None

        has_control_override = (
            request.default_agent_count is not None
            or request.rule_follow_ratio is not None
            or request.agent_speed is not None
            or request.spawn_groups is not None
        )
        if has_control_override:
            if pedsim_last_scene_request_store:
                regenerate_payload = dict(pedsim_last_scene_request_store)
                if request.default_agent_count is not None:
                    regenerate_payload["default_agent_count"] = max(1, int(request.default_agent_count))
                if request.rule_follow_ratio is not None:
                    regenerate_payload["rule_follow_ratio"] = float(request.rule_follow_ratio)
                if request.agent_speed is not None:
                    regenerate_payload["agent_speed"] = float(request.agent_speed)
                if request.spawn_groups is not None:
                    regenerate_payload["spawn_groups"] = [group.dict() for group in request.spawn_groups]

                generated = build_pedsim_scene_from_map(PedSimSceneFromMapRequest(**regenerate_payload))
                scene_file = generated.get("demoapp_scene_file") or scene_file
            else:
                runtime_note = (
                    "PedSim controls were provided before map export completed; "
                    "runtime started with current scene defaults."
                )

        status = pedsim_runtime_manager.start(
            scene_file=scene_file,
            listen_port=request.listen_port,
            backend_url=request.backend_url,
            force_restart=request.force_restart,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "message": "PedSim runtime started",
        "note": runtime_note,
        **status,
    }


@app.post("/pedsim/runtime/stop")
def stop_pedsim_runtime():
    """Stop PedSim demoapp and bridge processes."""
    status = pedsim_runtime_manager.stop()
    clear_pedsim_state()
    return {
        "message": "PedSim runtime stopped",
        **status,
    }


def _geo_to_local(lng: float, lat: float, origin_lng: float, origin_lat: float, scale: float) -> tuple[float, float]:
    x = (lng - origin_lng) / scale
    y = (origin_lat - lat) / scale
    return x, y


def _iter_polygon_rings(geometry: Dict[str, Any]) -> List[List[List[float]]]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon" and coords:
        return [coords[0]]
    if gtype == "MultiPolygon" and coords:
        return [poly[0] for poly in coords if poly]
    return []


def _iter_lines(geometry: Dict[str, Any]) -> List[List[List[float]]]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if gtype == "LineString" and coords:
        return [coords]
    if gtype == "MultiLineString" and coords:
        return [line for line in coords if line]
    return []


def _collect_geometry_points(*feature_groups: Any) -> List[List[float]]:
    coords: List[List[float]] = []

    for group in feature_groups:
        features = group or []
        for feature in features:
            geometry = feature.get("geometry") or {}
            for ring in _iter_polygon_rings(geometry):
                coords.extend([point for point in ring if len(point) >= 2])
            for line in _iter_lines(geometry):
                coords.extend([point for point in line if len(point) >= 2])
            if geometry.get("type") == "Point":
                point = geometry.get("coordinates") or []
                if len(point) >= 2:
                    coords.append(point)

    return coords


def _compute_scene_origin(
    boundary_feature: Optional[Dict[str, Any]],
    building_features: List[Dict[str, Any]],
    pathway_features: List[Dict[str, Any]],
    fallback_lng: float,
    fallback_lat: float,
) -> tuple[float, float]:
    points = _collect_geometry_points(
        [boundary_feature] if boundary_feature else [],
        building_features,
        pathway_features,
    )
    if not points:
        return fallback_lng, fallback_lat

    lngs = [point[0] for point in points]
    lats = [point[1] for point in points]
    return (min(lngs) + max(lngs)) / 2.0, (min(lats) + max(lats)) / 2.0


def _feature_center(feature: Dict[str, Any]) -> Optional[List[float]]:
    center = feature.get("properties", {}).get("center")
    if isinstance(center, list) and len(center) >= 2:
        return [float(center[0]), float(center[1])]

    geometry = feature.get("geometry") or {}
    points = _collect_geometry_points([feature])
    if not points:
        return None

    return [
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    ]


def _collect_pathway_geo_points(pathway_features: List[Dict[str, Any]]) -> List[List[float]]:
    points: List[List[float]] = []
    for feature in pathway_features:
        geometry = feature.get("geometry") or {}
        for line in _iter_lines(geometry):
            for point in line:
                if len(point) < 2:
                    continue
                points.append([float(point[0]), float(point[1])])
    return points


def _feature_access_point(feature: Dict[str, Any], pathway_points: List[List[float]]) -> Optional[List[float]]:
    """Choose a point near the building edge (preferably near a pathway) to avoid spawning agents inside sealed buildings."""
    rings = _iter_polygon_rings(feature.get("geometry") or {})
    ring = rings[0] if rings else []
    if not ring:
        return _feature_center(feature)

    centroid = _feature_center(feature)
    if not centroid:
        return [float(ring[0][0]), float(ring[0][1])]

    best_point = [float(ring[0][0]), float(ring[0][1])]
    if pathway_points:
        best_distance = float("inf")
        for candidate in ring:
            if len(candidate) < 2:
                continue
            cx = float(candidate[0])
            cy = float(candidate[1])
            nearest = min(
                ((cx - path_point[0]) ** 2 + (cy - path_point[1]) ** 2) ** 0.5
                for path_point in pathway_points
            )
            if nearest < best_distance:
                best_distance = nearest
                best_point = [cx, cy]

    # Nudge slightly outside the building perimeter so agents can move.
    outward_scale = 1.06
    return [
        centroid[0] + (best_point[0] - centroid[0]) * outward_scale,
        centroid[1] + (best_point[1] - centroid[1]) * outward_scale,
    ]


def _append_unique_waypoint(route: List[Dict[str, Any]], candidate: Dict[str, Any]):
    if candidate["id"] not in {item["id"] for item in route}:
        route.append(candidate)


def _dedupe_waypoint_candidates(candidates: List[Dict[str, Any]], min_distance: float = 6.0) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []

    for candidate in candidates:
        x = candidate["x"]
        y = candidate["y"]
        if any(((x - existing["x"]) ** 2 + (y - existing["y"]) ** 2) ** 0.5 < min_distance for existing in deduped):
            continue
        deduped.append(candidate)

    return deduped


def _write_scene_file(path: str, contents: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as scene_file:
        scene_file.write(contents)


@app.post("/pedsim/scene-from-map")
def build_pedsim_scene_from_map(payload: PedSimSceneFromMapRequest):
    """Generate a PedSim scene XML file from map-extracted geometry."""
    global pedsim_last_scene_request_store

    scale = payload.scale if payload.scale > 0 else 0.00003
    follow_ratio = min(1.0, max(0.0, payload.rule_follow_ratio))
    agent_speed = min(3.5, max(0.4, payload.agent_speed))

    # Keep latest map geometry payload so runtime start can regenerate scene
    # with updated controls from the simulation pane.
    pedsim_last_scene_request_store = payload.dict()

    building_features = payload.buildings.get("features", []) if isinstance(payload.buildings, dict) else []
    pathway_features = payload.pathways.get("features", []) if isinstance(payload.pathways, dict) else []

    boundary_feature = None
    if isinstance(payload.boundary, dict):
        features = payload.boundary.get("features", [])
        boundary_feature = features[0] if features else None

    origin_lng, origin_lat = _compute_scene_origin(
        boundary_feature,
        building_features,
        pathway_features,
        payload.origin_lng,
        payload.origin_lat,
    )

    xml_lines = ["<scenario>"]

    obstacle_count = 0
    road_segment_count = 0
    for feature in building_features:
        for ring in _iter_polygon_rings(feature.get("geometry") or {}):
            if len(ring) < 2:
                continue
            for i in range(len(ring) - 1):
                start = ring[i]
                end = ring[i + 1]
                if len(start) < 2 or len(end) < 2:
                    continue
                x1, y1 = _geo_to_local(start[0], start[1], origin_lng, origin_lat, scale)
                x2, y2 = _geo_to_local(end[0], end[1], origin_lng, origin_lat, scale)
                xml_lines.append(
                    f"  <obstacle x1=\"{x1:.2f}\" y1=\"{y1:.2f}\" x2=\"{x2:.2f}\" y2=\"{y2:.2f}\" />"
                )
                obstacle_count += 1

    if boundary_feature:
        for ring in _iter_polygon_rings(boundary_feature.get("geometry") or {}):
            if len(ring) < 2:
                continue
            for i in range(len(ring) - 1):
                start = ring[i]
                end = ring[i + 1]
                if len(start) < 2 or len(end) < 2:
                    continue
                x1, y1 = _geo_to_local(start[0], start[1], origin_lng, origin_lat, scale)
                x2, y2 = _geo_to_local(end[0], end[1], origin_lng, origin_lat, scale)
                xml_lines.append(
                    f"  <obstacle x1=\"{x1:.2f}\" y1=\"{y1:.2f}\" x2=\"{x2:.2f}\" y2=\"{y2:.2f}\" />"
                )
                obstacle_count += 1

    # Add roads as visual lines for demoapp UI (non-blocking, unlike obstacles).
    for feature in pathway_features[:220]:
        for line in _iter_lines(feature.get("geometry") or {}):
            if len(line) < 2:
                continue
            for i in range(len(line) - 1):
                start = line[i]
                end = line[i + 1]
                if len(start) < 2 or len(end) < 2:
                    continue
                x1, y1 = _geo_to_local(start[0], start[1], origin_lng, origin_lat, scale)
                x2, y2 = _geo_to_local(end[0], end[1], origin_lng, origin_lat, scale)
                xml_lines.append(
                    f"  <road x1=\"{x1:.2f}\" y1=\"{y1:.2f}\" x2=\"{x2:.2f}\" y2=\"{y2:.2f}\" />"
                )
                road_segment_count += 1

    pathway_points_geo = _collect_pathway_geo_points(pathway_features)

    waypoint_candidates: List[Dict[str, Any]] = []
    for feature_index, feature in enumerate(building_features[:30]):
        access_point = _feature_access_point(feature, pathway_points_geo)
        if not access_point:
            continue
        x, y = _geo_to_local(access_point[0], access_point[1], origin_lng, origin_lat, scale)
        waypoint_candidates.append({
            "id": f"b{feature_index + 1}",
            "x": x,
            "y": y,
            "r": 12,
            "kind": "building_access",
        })

    for feature in pathway_features[:220]:
        for line in _iter_lines(feature.get("geometry") or {}):
            if len(line) < 2:
                continue
            sample_indices = sorted({0, len(line) // 4, len(line) // 2, (3 * len(line)) // 4, len(line) - 1})
            for idx in sample_indices:
                point = line[idx]
                if len(point) < 2:
                    continue
                x, y = _geo_to_local(point[0], point[1], origin_lng, origin_lat, scale)
                waypoint_candidates.append({
                    "id": f"p{len(waypoint_candidates) + 1}",
                    "x": x,
                    "y": y,
                    "r": 10,
                    "kind": "pathway",
                })

    sampled_waypoints = _dedupe_waypoint_candidates(waypoint_candidates, min_distance=8.0)[:72]

    for waypoint in sampled_waypoints:
        xml_lines.append(
            f"  <waypoint id=\"{waypoint['id']}\" x=\"{waypoint['x']:.2f}\" y=\"{waypoint['y']:.2f}\" r=\"{waypoint['r']:.0f}\" />"
        )

    pathway_waypoints = [waypoint for waypoint in sampled_waypoints if waypoint["kind"] == "pathway"] or sampled_waypoints
    building_access_waypoints = [waypoint for waypoint in sampled_waypoints if waypoint["kind"] == "building_access"]
    routing_pool = pathway_waypoints + [
        waypoint for waypoint in building_access_waypoints if waypoint["id"] not in {item["id"] for item in pathway_waypoints}
    ]

    spawn_points = [
        {
            "index": index,
            "waypoint_id": waypoint["id"],
            "x": round(float(waypoint["x"]), 2),
            "y": round(float(waypoint["y"]), 2),
        }
        for index, waypoint in enumerate(pathway_waypoints)
    ]

    agent_group_count = 0
    seeded_agents = 0
    agent_group_mappings: List[Dict[str, Any]] = []
    next_agent_id = 0

    if payload.include_agents and pathway_waypoints:
        custom_spawn_groups = payload.spawn_groups or []

        if custom_spawn_groups:
            for group_index, group in enumerate(custom_spawn_groups):
                start_index = max(0, int(group.start_index))
                if start_index >= len(pathway_waypoints):
                    continue

                start_waypoint = pathway_waypoints[start_index]
                group_size = max(1, int(group.count))
                group_adherence = group.adherence if group.adherence is not None else follow_ratio
                group_adherence = min(1.0, max(0.0, float(group_adherence)))
                group_route_span = group.route_span if group.route_span is not None else max(4, len(pathway_waypoints) // 10)
                group_route_span = max(2, min(len(pathway_waypoints), int(group_route_span)))
                group_cohort = str(group.cohort_id or "pedsim").lower()
                group_color = str(group.color).strip() if group.color else None

                route: List[Dict[str, Any]] = [start_waypoint]
                stride = max(1, len(pathway_waypoints) // group_route_span)
                for step in range(1, group_route_span):
                    candidate = pathway_waypoints[(start_index + step * stride) % len(pathway_waypoints)]
                    _append_unique_waypoint(route, candidate)

                if building_access_waypoints:
                    access_target = building_access_waypoints[group_index % len(building_access_waypoints)]
                    _append_unique_waypoint(route, access_target)

                if len(route) < 2:
                    continue

                spread = 9 if group_adherence >= 0.6 else 14
                xml_lines.append(
                    f"  <agent x=\"{start_waypoint['x']:.2f}\" y=\"{start_waypoint['y']:.2f}\" n=\"{group_size}\" dx=\"{spread}\" dy=\"{spread}\" vmax=\"{agent_speed:.2f}\" adherence=\"{group_adherence:.2f}\">"
                )
                for waypoint in route:
                    xml_lines.append(f"    <addwaypoint id=\"{waypoint['id']}\" />")
                for waypoint in reversed(route[1:-1]):
                    xml_lines.append(f"    <addwaypoint id=\"{waypoint['id']}\" />")
                xml_lines.append("  </agent>")

                agent_group_mappings.append({
                    "group_index": agent_group_count,
                    "agent_id_start": next_agent_id,
                    "agent_id_end": next_agent_id + group_size - 1,
                    "cohort_id": group_cohort,
                    "color": group_color,
                    "start_index": start_index,
                    "waypoint_id": start_waypoint["id"],
                    "count": group_size,
                })
                next_agent_id += group_size
                agent_group_count += 1
                seeded_agents += group_size
        elif len(pathway_waypoints) >= 3:
            total_agents = max(20, payload.default_agent_count)
            group_count = min(8, max(2, len(pathway_waypoints) // 2))
            agents_per_group = max(8, total_agents // group_count)
            compliant_group_count = max(1, int(round(group_count * follow_ratio)))

            for group_index in range(group_count):
                is_compliant_group = group_index < compliant_group_count
                start_pool = pathway_waypoints if pathway_waypoints else routing_pool
                if not start_pool:
                    continue

                start_waypoint = start_pool[group_index % len(start_pool)]
                route: List[Dict[str, Any]] = [start_waypoint]

                if is_compliant_group:
                    stride = max(1, len(pathway_waypoints) // max(2, group_count))
                    for step in range(1, min(8, len(pathway_waypoints))):
                        candidate = pathway_waypoints[(group_index * stride + step * stride) % len(pathway_waypoints)]
                        _append_unique_waypoint(route, candidate)

                    if building_access_waypoints:
                        access_target = building_access_waypoints[group_index % len(building_access_waypoints)]
                        _append_unique_waypoint(route, access_target)
                else:
                    rng = random.Random((group_index + 1) * 7919 + total_agents)
                    non_compliant_target_len = min(8, len(routing_pool))
                    while len(route) < non_compliant_target_len:
                        candidate = routing_pool[rng.randrange(len(routing_pool))]
                        _append_unique_waypoint(route, candidate)

                if len(route) < 2:
                    continue

                adherence = 1.0 if is_compliant_group else max(0.15, follow_ratio * 0.5)
                spread = 9 if is_compliant_group else 14
                xml_lines.append(
                    f"  <agent x=\"{start_waypoint['x']:.2f}\" y=\"{start_waypoint['y']:.2f}\" n=\"{agents_per_group}\" dx=\"{spread}\" dy=\"{spread}\" vmax=\"{agent_speed:.2f}\" adherence=\"{adherence:.2f}\">"
                )
                for waypoint in route:
                    xml_lines.append(f"    <addwaypoint id=\"{waypoint['id']}\" />")
                for waypoint in reversed(route[1:-1]):
                    xml_lines.append(f"    <addwaypoint id=\"{waypoint['id']}\" />")
                xml_lines.append("  </agent>")

                start_index = next((item["index"] for item in spawn_points if item["waypoint_id"] == start_waypoint["id"]), 0)
                agent_group_mappings.append({
                    "group_index": agent_group_count,
                    "agent_id_start": next_agent_id,
                    "agent_id_end": next_agent_id + agents_per_group - 1,
                    "cohort_id": "pedsim",
                    "color": None,
                    "start_index": start_index,
                    "waypoint_id": start_waypoint["id"],
                    "count": agents_per_group,
                })

                next_agent_id += agents_per_group
                agent_group_count += 1
                seeded_agents += agents_per_group

    spawn_group_payload = {
        "updated_at": datetime.now().isoformat(),
        "total_agents": seeded_agents,
        "groups": agent_group_mappings,
        "spawn_points": spawn_points,
    }
    try:
        with open(PEDSIM_SPAWN_GROUPS_PATH, "w", encoding="utf-8") as spawn_file:
            json.dump(spawn_group_payload, spawn_file, ensure_ascii=True, indent=2)
    except Exception as exc:
        print(f"Could not write PedSim spawn group map: {exc}")

    xml_lines.append("</scenario>")

    scene_contents = "\n".join(xml_lines) + "\n"
    _write_scene_file(PEDSIM_SCENE_EXPORT_PATH, scene_contents)

    try:
        _write_scene_file(PEDSIM_DEMOAPP_SCENE_PATH, scene_contents)
    except Exception as exc:
        print(f"Could not mirror PedSim scene into demoapp scene.xml: {exc}")

    pedsim_scene_transform_store.update({
        "origin_lng": origin_lng,
        "origin_lat": origin_lat,
        "scale": scale,
        "updated_at": datetime.now().isoformat(),
        "boundary_source": "selected_area" if boundary_feature else "map_bbox",
        "scene_file": PEDSIM_SCENE_EXPORT_PATH,
        "demoapp_scene_file": PEDSIM_DEMOAPP_SCENE_PATH,
        "rule_follow_ratio": follow_ratio,
        "agent_speed": agent_speed,
    })
    _persist_scene_transform_store()

    return {
        "message": "PedSim scene generated from map geometry",
        "scene_file": PEDSIM_SCENE_EXPORT_PATH,
        "demoapp_scene_file": PEDSIM_DEMOAPP_SCENE_PATH,
        "building_features": len(building_features),
        "pathway_features": len(pathway_features),
        "obstacles_written": obstacle_count,
        "road_segments_written": road_segment_count,
        "waypoints_written": len(sampled_waypoints),
        "agent_groups_written": agent_group_count,
        "agents_seeded": seeded_agents,
        "spawn_points": spawn_points,
        "spawn_groups": agent_group_mappings,
        "spawn_group_map_file": PEDSIM_SPAWN_GROUPS_PATH,
        "rule_follow_ratio": follow_ratio,
        "agent_speed": agent_speed,
        "scene_transform": dict(pedsim_scene_transform_store),
    }


# ==================== EVENT ROOM ALLOCATION API ====================

@app.post("/sites")
def create_site_endpoint(payload: SiteCreate):
    try:
        return create_site(payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/buildings")
def create_building_endpoint(payload: BuildingCreate):
    try:
        return create_building(payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/rooms")
def create_room_endpoint(payload: RoomCreate):
    try:
        return create_room(payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/rooms/{room_id}/facilities")
def upsert_room_facilities_endpoint(room_id: str, payload: RoomFacilitiesUpsertRequest):
    try:
        return upsert_room_facilities(
            room_id,
            [row.dict() for row in payload.facilities],
            [row.dict() for row in payload.proximities],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/event-types")
def create_event_type_endpoint(payload: EventTypeCreate):
    try:
        return create_event_type(payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/event-profiles")
def create_event_profile_endpoint(payload: EventProfileCreate):
    try:
        return create_event_profile(payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/bookings")
def create_booking_endpoint(payload: BookingCreate):
    try:
        return create_booking(payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/occupancy-signals")
def create_occupancy_signal_endpoint(payload: OccupancySignalCreate):
    try:
        return create_occupancy_signal(payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/allocations/run")
def run_allocation_endpoint(payload: AllocationRunRequest):
    if payload.bookingId is None:
        if payload.expectedAttendance is None or payload.startAt is None or payload.endAt is None:
            raise HTTPException(
                status_code=400,
                detail="expectedAttendance, startAt, and endAt are required when bookingId is not supplied",
            )
        if payload.eventTypeId is None and payload.customEventType is None:
            raise HTTPException(
                status_code=400,
                detail="eventTypeId or customEventType is required when bookingId is not supplied",
            )

    try:
        allocation_input = payload.dict()
        allocation_input["complianceMode"] = payload.complianceMode.value
        return run_allocation(allocation_input)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/allocations/{run_id}")
def get_allocation_run_endpoint(run_id: str):
    try:
        return get_allocation_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/allocations/{run_id}/manual-override")
def manual_override_endpoint(run_id: str, payload: ManualOverrideRequest):
    try:
        return manual_override(
            run_id=run_id,
            chosen_candidate_key=payload.chosenCandidateKey,
            overridden_by=payload.overriddenBy,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/allocations/seed")
def seed_allocation_data(force: bool = False):
    return seed_default_data(force=force)


@app.get("/allocations/catalog")
def get_allocation_catalog():
    return {
        "sites": list(sites_store.values()),
        "buildings": list(buildings_store.values()),
        "rooms": list(rooms_store.values()),
        "facilityTypes": list(facility_types_store.values()),
        "eventTypes": list(event_types_store.values()),
        "eventProfiles": list(event_profiles_store.values()),
        "bookings": list(bookings_store.values()),
        "bookingRooms": booking_rooms_store,
        "occupancySignals": occupancy_signals_store,
    }


@app.websocket("/pedsim/ws")
async def pedsim_state_stream(websocket: WebSocket):
    """Stream the latest PedSim frame to connected frontend clients."""
    connection_id = await pedsim_stream_manager.connect(websocket)
    try:
        pedsim_stream_manager.queue_for_connection(connection_id, {
            "sim_time": pedsim_state_store.get("sim_time"),
            "timestamp": pedsim_state_store.get("timestamp"),
            "stream_id": pedsim_state_store.get("stream_id"),
            "stream_sequence": pedsim_state_store.get("stream_sequence", 0),
            "agents": pedsim_state_store.get("agents", []),
            "metadata": pedsim_state_store.get("metadata", {}),
            "agent_count": len(pedsim_state_store.get("agents", [])),
            "scene_transform": dict(pedsim_scene_transform_store),
            "type": "snapshot",
        })

        while True:
            message = await websocket.receive_text()
            if message.lower() == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pedsim_stream_manager.disconnect(websocket)
    except Exception:
        pedsim_stream_manager.disconnect(websocket)


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8904")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
