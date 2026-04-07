from fastapi import FastAPI, HTTPException, File, UploadFile
import os
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

from schemas import (
    Event,
    EventRequest,
    CongestionWithEventsRequest,
    ActuationRequest,
    BehaviorRequest,
    SummarizationRequest,
    RouterRequest,
)
from logic import (
    ai_suggest_building,
    fallback_dynamic_suggestion,
    build_movement_plan_from_csv,
    aggregate_category_counts,
    aggregate_category_counts_with_events,
    build_congestion_response,
    run_actuation_graph,
    behavior_next_action_probabilities,
    summarize_run,
    route_task,
)

app = FastAPI(title="Digital Twin Backend")

events_db = []
current_schedule = None

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

    plan = await build_movement_plan_from_csv(file)
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


@app.get("/live-movements")
def get_live_movements(sim_time: float = 8.0):
    """Get currently active movements for a specific simulation time"""
    if current_schedule is None:
        return {
            "active_movements": [],
            "message": "No schedule loaded. Upload a CSV first."
        }
    
    # Convert sim_time to HH:MM format
    hour = int(sim_time)
    minute = int((sim_time - hour) * 60)
    current_time_str = f"{hour:02d}:{minute:02d}"
    
    active_movements = []
    movements = current_schedule.get("movements", [])
    
    for movement in movements:
        start_time = movement.get("start_time", "")
        end_time = movement.get("end_time", "")
        
        # Check if current_time_str falls within the movement window
        if start_time <= current_time_str <= end_time:
            active_movements.append({
                "event_name": f"{movement.get('venue', 'Event')} - {movement.get('group', 'Group')}",
                "venue": movement.get('venue', 'Unknown Venue'),
                "group": movement.get('group', 'Unknown'),
                "from_location": movement.get('from_location', 'Unknown'),
                "attendees": movement.get('attendees', 0),
                "start_time": start_time,
                "end_time": end_time,
                "priority": movement.get('priority', 'medium'),
                "flow_id": movement.get('flow_id', '')
            })
    
    return {
        "sim_time": sim_time,
        "active_movements": active_movements,
        "count": len(active_movements)
    }


@app.get("/congestion")
def get_congestion(sim_time: float = 8.0):
    hour = int(sim_time)
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


@app.post("/v1/behavior/next-action-probabilities")
def next_action_probabilities(payload: BehaviorRequest):
    return behavior_next_action_probabilities(payload)


@app.post("/v1/insights/summarize-run")
def summarize_simulation_run(payload: SummarizationRequest):
    return summarize_run(payload)


@app.post("/v1/orchestrator/route-task")
def route_orchestration_task(payload: RouterRequest):
    return route_task(payload)


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
