from fastapi import FastAPI, HTTPException, File, UploadFile
from typing import List, Optional, Dict, Any
import os
import csv
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
    UserRole,
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

app = FastAPI(title="Digital Twin Backend")

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


# Create uploads directory if it doesn't exist
UPLOADS_DIR = "uploads"
os.makedirs(UPLOADS_DIR, exist_ok=True)


@app.on_event("startup")
def _restore_schedule_on_startup():
    """Restore the last uploaded CSV on backend restart."""
    global current_schedule
    filepath = os.path.join(UPLOADS_DIR, "current_movement_plan.csv")
    if not os.path.exists(filepath):
        return
    try:
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


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
