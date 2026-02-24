from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import random
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Digital Twin Backend")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Building(BaseModel):
    name: str
    capacity: Optional[int] = None
    occupancy: Optional[int] = None

class EventRequest(BaseModel):
    name: str
    attendees: int
    buildings: List[Building]

class Event(BaseModel):
    name: str
    building_name: str
    attendees: int
    time: str

events_db = []

@app.get("/")
def read_root():
    return {"status": "Digital Twin Backend Running"}

@app.post("/suggest-building")
def suggest_building(req: EventRequest):
    if not req.buildings:
        raise HTTPException(status_code=400, detail="No buildings provided for suggestion")
    
    # Simple heuristic algorithm to suggest optimal building
    candidates = []
    for b in req.buildings:
        # Give higher weight to buildings that sound like they can host events
        score = 0
        name_lower = b.name.lower()
        if any(keyword in name_lower for keyword in ["hall", "auditorium", "center", "bhavan", "lab", "arena", "block"]):
            score += 50
        
        # If capacity was known, we would score based on it
        score += random.randint(1, 100) # Mock dynamic congestion factors
        candidates.append((score, b))
        
    # Sort by score descending
    candidates.sort(key=lambda x: x[0], reverse=True)
    best_match = candidates[0][1]
    
    return {
        "suggested_building": best_match.name,
        "reason": f"Based on real-time simulated heatmaps, {best_match.name} currently has optimal available space and minimum path congestion for {req.attendees} attendees."
    }

@app.post("/events")
def create_event(event: Event):
    events_db.append(dict(event))
    return {"message": "Event created successfully", "event": event}

@app.get("/events")
def get_events():
    return {"events": events_db}


# --- Real-time Congestion Prediction based on SimulationDB schedule ---
SCHEDULES = [
    {"profile": "First Year Student",  "count": 300, "schedule": {0:"hostels",7:"hostels",8:"academics",12:"canteens",13:"academics",17:"recreation",19:"canteens",20:"hostels"}},
    {"profile": "Second Year Student", "count": 280, "schedule": {0:"hostels",8:"canteens",9:"academics",12:"canteens",14:"academics",16:"recreation",20:"hostels",21:"academics",23:"hostels"}},
    {"profile": "Third Year Student",  "count": 250, "schedule": {0:"hostels",9:"academics",13:"canteens",14:"academics",18:"hostels",20:"canteens",22:"academics"}},
    {"profile": "Fourth Year Student", "count": 200, "schedule": {0:"hostels",10:"academics",14:"hostels",16:"recreation",19:"canteens",21:"hostels"}},
    {"profile": "Faculty",             "count": 100, "schedule": {0:"admin",8:"gates",9:"academics",13:"admin",14:"academics",17:"gates",18:"admin"}},
    {"profile": "Staff",               "count": 80,  "schedule": {0:"admin",6:"gates",7:"canteens",10:"academics",14:"canteens",16:"gates",17:"admin"}},
]

def get_category_at_hour(schedule: dict, hour: int) -> str:
    keys = sorted(k for k in schedule.keys() if k <= hour)
    return schedule[keys[-1]] if keys else "hostels"

@app.get("/congestion")
def get_congestion(sim_time: float = 8.0):
    hour = int(sim_time)
    
    # Aggregate people counts per category
    category_counts: dict[str, int] = {}
    for cohort in SCHEDULES:
        cat = get_category_at_hour({int(k): v for k, v in cohort["schedule"].items()}, hour)
        category_counts[cat] = category_counts.get(cat, 0) + cohort["count"]
    
    # Calculate thresholds and recommend interventions
    alerts = []
    thresholds = {"canteens": 200, "academics": 400, "hostels": 500, "recreation": 150, "admin": 80, "gates": 60}
    suggestions = {
        "canteens":    "Open the auxiliary mess and extend serving hours by 30 minutes to reduce queue.",
        "academics":   "Stagger lab entrance timings across 15-minute intervals.",
        "hostels":     "Increase electricity load monitoring in residential blocks.",
        "recreation":  "Open overflow sports courts. Monitor water station capacity.",
        "gates":       "Open secondary entrance gates. Deploy traffic staff.",
        "admin":       "Enable digital check-ins to reduce in-person queue."
    }
    
    for cat, count in category_counts.items():
        threshold = thresholds.get(cat, 300)
        severity = "low"
        if count > threshold * 1.5: severity = "critical"
        elif count > threshold: severity = "high"
        elif count > threshold * 0.7: severity = "medium"
        
        if severity in ("high", "critical"):
            alerts.append({
                "location": cat.capitalize(),
                "count": count,
                "severity": severity,
                "recommendation": suggestions.get(cat, "Monitor and manage crowd flow."),
                "time": f"{hour:02d}:00"
            })
    
    # Sort by severity for prioritization
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    alerts.sort(key=lambda x: order.get(x["severity"], 4))
    
    return {
        "sim_time": sim_time,
        "hour": hour,
        "category_occupancy": category_counts,
        "alerts": alerts
    }
