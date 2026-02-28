from fastapi import FastAPI, HTTPException, File, UploadFile
from typing import List, Optional, Dict, Any
import os
import csv
from io import StringIO
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

from schemas import (
    Event,
    EventRequest,
    CongestionWithEventsRequest,
    ActuationRequest,
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


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
