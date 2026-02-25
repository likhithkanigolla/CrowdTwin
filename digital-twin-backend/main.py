from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import json
import os
from urllib import request as urllib_request
from urllib import error as urllib_error
from urllib import parse as urllib_parse
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Digital Twin Backend")

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
    ).split(",")
    if origin.strip()
]

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
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
    sim_time: Optional[float] = None

class Event(BaseModel):
    name: str
    building_name: str
    attendees: int
    time: str

events_db = []

@app.get("/")
def read_root():
    return {"status": "Digital Twin Backend Running"}


def infer_building_category(building_name: str) -> str:
    name = building_name.lower()
    if any(k in name for k in ["gate", "entrance", "exit"]):
        return "gates"
    if any(k in name for k in ["hostel", "dorm", "residence", "bhavan"]):
        return "hostels"
    if any(k in name for k in ["canteen", "mess", "food", "cafe"]):
        return "canteens"
    if any(k in name for k in ["admin", "office", "registrar"]):
        return "admin"
    if any(k in name for k in ["ground", "stadium", "sports", "recreation", "arena"]):
        return "recreation"
    return "academics"


def fallback_dynamic_suggestion(req: EventRequest) -> dict:
    if not req.buildings:
        raise HTTPException(status_code=400, detail="No buildings provided for suggestion")

    hour = int(req.sim_time) if req.sim_time is not None else None
    category_counts = aggregate_category_counts(hour) if hour is not None else {}

    scored = []
    for building in req.buildings:
        score = 0.0
        capacity = building.capacity
        occupancy = building.occupancy

        if capacity and occupancy is not None:
            free = max(0, capacity - occupancy)
            score += min(150.0, (free / max(1, req.attendees)) * 100.0)
            score += max(0.0, (1.0 - (occupancy / max(1, capacity))) * 80.0)
        elif capacity:
            score += min(80.0, (capacity / max(1, req.attendees)) * 60.0)
        else:
            score += 25.0

        category = infer_building_category(building.name)
        current_load = category_counts.get(category, 0)
        score -= current_load / 20.0

        if any(k in building.name.lower() for k in ["hall", "auditorium", "center", "block", "lab"]):
            score += 10.0

        scored.append((score, building, category, current_load))

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_building, best_category, best_load = scored[0]

    reason_parts = [
        f"{best_building.name} was selected due to stronger available capacity-fit for {req.attendees} attendees"
    ]
    if hour is not None:
        reason_parts.append(f"and lower estimated {best_category} zone load around {hour:02d}:00 (load={best_load})")
    reason = " ".join(reason_parts) + "."

    return {
        "suggested_building": best_building.name,
        "reason": reason,
        "source": "heuristic"
    }


def parse_strict_json(text: str) -> Optional[dict]:
    if not text:
        return None

    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            parsed = json.loads(cleaned[start:end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None


def validate_ai_result(req: EventRequest, ai_result: Optional[dict], source: str) -> Optional[dict]:
    if not ai_result:
        return None

    suggested = ai_result.get("suggested_building")
    reason = ai_result.get("reason")
    valid_names = {b.name for b in req.buildings}

    if suggested in valid_names and isinstance(reason, str) and reason.strip():
        return {
            "suggested_building": suggested,
            "reason": reason.strip(),
            "source": source
        }

    return None


def ai_suggest_openai(
    api_key: str,
    ai_url: str,
    ai_model: str,
    system_prompt: str,
    user_prompt: dict,
) -> Optional[dict]:
    payload = {
        "model": ai_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt)}
        ],
        "temperature": 0.2
    }

    request_obj = urllib_request.Request(
        ai_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        },
        method="POST"
    )

    with urllib_request.urlopen(request_obj, timeout=15) as response:
        body = response.read().decode("utf-8")
        parsed = json.loads(body)
        content = parsed["choices"][0]["message"]["content"]
        return parse_strict_json(content)


def ai_suggest_gemini(
    api_key: str,
    ai_url_template: str,
    ai_model: str,
    system_prompt: str,
    user_prompt: dict,
) -> Optional[dict]:
    base_url = ai_url_template.replace("{model}", ai_model)
    parsed_url = urllib_parse.urlsplit(base_url)
    query = urllib_parse.parse_qs(parsed_url.query)
    query["key"] = [api_key]
    final_url = urllib_parse.urlunsplit((
        parsed_url.scheme,
        parsed_url.netloc,
        parsed_url.path,
        urllib_parse.urlencode(query, doseq=True),
        parsed_url.fragment,
    ))

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            f"{system_prompt}\n\n"
                            "Input JSON:\n"
                            f"{json.dumps(user_prompt)}\n\n"
                            "Return strict JSON only."
                        )
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    }

    request_obj = urllib_request.Request(
        final_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urllib_request.urlopen(request_obj, timeout=15) as response:
        body = response.read().decode("utf-8")
        parsed = json.loads(body)
        parts = parsed["candidates"][0]["content"]["parts"]
        content = "\n".join(part.get("text", "") for part in parts if isinstance(part, dict))
        return parse_strict_json(content)


def ai_suggest_building(req: EventRequest) -> Optional[dict]:
    api_key = os.getenv("AI_API_KEY")
    if not api_key:
        return None

    provider = os.getenv("AI_PROVIDER", "openai").strip().lower()
    default_model = "gemini-2.5-flash-lite" if provider == "gemini" else "gpt-4o-mini"
    default_url = (
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        if provider == "gemini"
        else "https://api.openai.com/v1/chat/completions"
    )

    ai_url = os.getenv("AI_PROVIDER_URL", default_url)
    ai_model = os.getenv("AI_MODEL", default_model)
    hour = int(req.sim_time) if req.sim_time is not None else None
    category_counts = aggregate_category_counts(hour) if hour is not None else {}

    buildings_payload = [
        {
            "name": b.name,
            "capacity": b.capacity,
            "occupancy": b.occupancy,
            "inferred_category": infer_building_category(b.name)
        }
        for b in req.buildings
    ]

    system_prompt = (
        "You are a campus digital twin decision assistant. "
        "Choose the best building for an event while minimizing congestion and ensuring enough space. "
        "Return ONLY strict JSON with keys: suggested_building (string), reason (string)."
    )
    user_prompt = {
        "event": {"name": req.name, "attendees": req.attendees, "sim_time": req.sim_time},
        "buildings": buildings_payload,
        "category_occupancy": category_counts,
        "instruction": "Pick one building from the input list only. Keep reason concise and practical."
    }

    try:
        if provider == "gemini":
            ai_result = ai_suggest_gemini(api_key, ai_url, ai_model, system_prompt, user_prompt)
            return validate_ai_result(req, ai_result, "ai-gemini")

        ai_result = ai_suggest_openai(api_key, ai_url, ai_model, system_prompt, user_prompt)
        return validate_ai_result(req, ai_result, "ai-openai")
    except (urllib_error.URLError, urllib_error.HTTPError, TimeoutError, KeyError, IndexError, json.JSONDecodeError, TypeError, ValueError):
        return None


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


def aggregate_category_counts(hour: int) -> dict[str, int]:
    category_counts: dict[str, int] = {}
    for cohort in SCHEDULES:
        cat = get_category_at_hour({int(k): v for k, v in cohort["schedule"].items()}, hour)
        category_counts[cat] = category_counts.get(cat, 0) + cohort["count"]
    return category_counts

@app.get("/congestion")
def get_congestion(sim_time: float = 8.0):
    hour = int(sim_time)

    category_counts = aggregate_category_counts(hour)
    
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


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
