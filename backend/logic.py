from fastapi import HTTPException, UploadFile
from typing import Optional, List
import csv
import json
import os
from datetime import datetime, timedelta
from io import StringIO
from urllib import request as urllib_request
from urllib import error as urllib_error
from urllib import parse as urllib_parse

from schemas import Event, EventRequest, ActuationRequest, ActuationState

try:
    from langgraph.graph import END, StateGraph
    LANGGRAPH_AVAILABLE = True
except ImportError:
    END = "END"
    StateGraph = None
    LANGGRAPH_AVAILABLE = False


MOVEMENT_GROUPS = [
    ("UG1", "UG1_Capacity", "UG1_loc"),
    ("UG2", "UG2_Capacity", "UG2_loc"),
    ("UG3", "UG3_Capacity", "UG3_loc"),
    ("UG4", "UG4_Capacity", "UG4_loc"),
    ("Faculty", "Faculty_Capacity", "Faculty_loc"),
    ("Staff", "Staff_Capacity", "Staff_loc"),
]

DATE_FORMATS = ["%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"]
TIME_FORMATS = ["%H:%M", "%H.%M", "%I:%M %p", "%I %p"]
DEFAULT_START_TIME = "09:00"
DEFAULT_END_BUFFER_MINUTES = 60


SCHEDULES = [
    {"profile": "First Year Student", "count": 300, "schedule": {0: "hostels", 7: "hostels", 8: "academics", 12: "canteens", 13: "academics", 17: "recreation", 19: "canteens", 20: "hostels"}},
    {"profile": "Second Year Student", "count": 280, "schedule": {0: "hostels", 8: "canteens", 9: "academics", 12: "canteens", 14: "academics", 16: "recreation", 20: "hostels", 21: "academics", 23: "hostels"}},
    {"profile": "Third Year Student", "count": 250, "schedule": {0: "hostels", 9: "academics", 13: "canteens", 14: "academics", 18: "hostels", 20: "canteens", 22: "academics"}},
    {"profile": "Fourth Year Student", "count": 200, "schedule": {0: "hostels", 10: "academics", 14: "hostels", 16: "recreation", 19: "canteens", 21: "hostels"}},
    {"profile": "Faculty", "count": 100, "schedule": {0: "admin", 8: "gates", 9: "academics", 13: "admin", 14: "academics", 17: "gates", 18: "admin"}},
    {"profile": "Staff", "count": 80, "schedule": {0: "admin", 6: "gates", 7: "canteens", 10: "academics", 14: "canteens", 16: "gates", 17: "admin"}},
]


def _normalize_csv_row(row: dict[str, Optional[str]]) -> dict[str, str]:
    return {k.strip(): (v or "").strip() for k, v in row.items() if k and k.strip()}


def _try_parse_date(value: str, row_idx: int) -> datetime.date:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Row {row_idx}: could not parse Date '{value}'. Expected format YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY.")


def _try_parse_time(value: str, row_idx: int, column_name: str) -> datetime.time:
    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            continue
    raise ValueError(f"Row {row_idx}: could not parse {column_name} '{value}'. Expected HH:MM or hh:mm AM/PM.")


def _parse_datetime_field(date_value: str, time_value: str, row_idx: int, column_name: str, fallback: str) -> datetime:
    if not date_value:
        raise ValueError(f"Row {row_idx}: Date cannot be empty.")

    time_candidate = time_value or fallback
    parsed_date = _try_parse_date(date_value, row_idx)
    parsed_time = _try_parse_time(time_candidate, row_idx, column_name)
    return datetime.combine(parsed_date, parsed_time)


def _calculate_lead_minutes(duration_minutes: float) -> int:
    if duration_minutes <= 0:
        return 15
    value = round(duration_minutes / 2)
    return max(5, min(30, value))


def _classify_priority(share: float) -> str:
    if share >= 0.35:
        return "critical"
    if share >= 0.25:
        return "high"
    if share >= 0.1:
        return "medium"
    return "low"


def _slugify(value: str) -> str:
    stripped = "".join(ch.lower() if ch.isalnum() else "_" for ch in value)
    return stripped.strip("_") or "venue"


def _clean_location(value: str) -> str:
    clean = value.strip()
    return clean or "Unknown origin"


def _parse_capacity_value(raw_value: str) -> int:
    if not raw_value:
        return 0
    try:
        parsed = float(raw_value)
        return int(round(parsed))
    except ValueError:
        return 0


def _build_flow_id(date_str: str, venue: str, group: str, start_dt: datetime) -> str:
    venue_code = _slugify(venue)
    time_code = start_dt.strftime("%H%M")
    return f"{date_str}_{venue_code}_{group}_{time_code}"


def _build_movements_for_row(row: dict[str, str], row_idx: int) -> tuple[list[dict], dict]:
    date_value = row.get("Date", "")
    venue = row.get("Venue", "")
    if not venue:
        raise ValueError(f"Row {row_idx}: Venue cannot be empty.")

    start_time = row.get("Start_time", "")
    end_time = row.get("End_time", "")
    start_dt = _parse_datetime_field(date_value, start_time, row_idx, "Start_time", DEFAULT_START_TIME)
    if end_time:
        try:
            end_dt = _parse_datetime_field(date_value, end_time, row_idx, "End_time", DEFAULT_START_TIME)
        except ValueError:
            end_dt = start_dt + timedelta(minutes=DEFAULT_END_BUFFER_MINUTES)
    else:
        end_dt = start_dt + timedelta(minutes=DEFAULT_END_BUFFER_MINUTES)

    if end_dt <= start_dt:
        end_dt = start_dt + timedelta(minutes=DEFAULT_END_BUFFER_MINUTES)

    duration_minutes = max(1.0, (end_dt - start_dt).total_seconds() / 60.0)

    total_capacity = _parse_capacity_value(row.get("Total_Capacity", ""))
    group_capacities = []
    group_capacity_total = 0

    for group_name, cap_column, loc_column in MOVEMENT_GROUPS:
        capacity = _parse_capacity_value(row.get(cap_column, ""))
        if capacity <= 0:
            continue
        location = _clean_location(row.get(loc_column, ""))
        group_capacities.append((group_name, capacity, location))
        group_capacity_total += capacity

    if not group_capacities:
        raise ValueError(f"Row {row_idx}: At least one group must have a positive capacity.")

    effective_total = total_capacity if total_capacity > 0 else group_capacity_total
    if effective_total <= 0:
        effective_total = group_capacity_total

    lead_minutes = _calculate_lead_minutes(duration_minutes)
    departure_dt = start_dt - timedelta(minutes=lead_minutes)

    movements = []
    for group_name, capacity, location in group_capacities:
        share = round(capacity / max(effective_total, 1), 2)
        movement = {
            "flow_id": _build_flow_id(date_value, venue, group_name, start_dt),
            "row_index": row_idx,
            "date": date_value,
            "venue": venue,
            "group": group_name,
            "from_location": location,
            "attendees": capacity,
            "total_capacity": effective_total,
            "start_time": start_dt.strftime("%H:%M"),
            "end_time": end_dt.strftime("%H:%M"),
            "departure_time": departure_dt.strftime("%H:%M"),
            "arrival_time": start_dt.strftime("%H:%M"),
            "duration_minutes": int(duration_minutes),
            "share_of_total": share,
            "priority": _classify_priority(share),
            "venue_slug": _slugify(venue),
        }
        movements.append(movement)

    dominant = max(movements, key=lambda item: item["share_of_total"])
    unused_capacity = max(0, effective_total - group_capacity_total)

    row_summary = {
        "row_index": row_idx,
        "date": date_value,
        "venue": venue,
        "start_time": start_dt.strftime("%H:%M"),
        "end_time": end_dt.strftime("%H:%M"),
        "total_capacity": effective_total,
        "groups_scheduled": len(movements),
        "dominant_group": dominant["group"],
        "dominant_share": dominant["share_of_total"],
        "unused_capacity": unused_capacity,
    }

    return movements, row_summary


async def build_movement_plan_from_csv(file: UploadFile) -> dict:
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded CSV is empty.")

    text = contents.decode("utf-8-sig")
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


def get_category_at_hour(schedule: dict, hour: int) -> str:
    keys = sorted(k for k in schedule.keys() if k <= hour)
    return schedule[keys[-1]] if keys else "hostels"


def aggregate_category_counts(hour: int) -> dict[str, int]:
    category_counts: dict[str, int] = {}
    for cohort in SCHEDULES:
        cat = get_category_at_hour({int(k): v for k, v in cohort["schedule"].items()}, hour)
        category_counts[cat] = category_counts.get(cat, 0) + cohort["count"]
    return category_counts


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
    _, best_building, best_category, best_load = scored[0]

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


def _parse_event_hour(time_value: str) -> Optional[int]:
    if not time_value:
        return None

    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(time_value.strip(), fmt).hour
        except ValueError:
            continue
    return None


def aggregate_category_counts_with_events(sim_time: float, events: List[Event]) -> tuple[dict[str, int], int]:
    hour = int(sim_time)
    category_counts = aggregate_category_counts(hour)
    applied_events = 0

    for event in events:
        event_hour = _parse_event_hour(event.time)
        if event_hour is not None and event_hour != hour:
            continue

        category = infer_building_category(event.building_name)
        category_counts[category] = category_counts.get(category, 0) + max(0, event.attendees)
        applied_events += 1

    return category_counts, applied_events


def build_congestion_response(sim_time: float, category_counts: dict[str, int], events_applied: Optional[int] = None) -> dict:
    hour = int(sim_time)

    alerts = []
    thresholds = {"canteens": 200, "academics": 400, "hostels": 500, "recreation": 150, "admin": 80, "gates": 60}
    suggestions = {
        "canteens": "Open the auxiliary mess and extend serving hours by 30 minutes to reduce queue.",
        "academics": "Stagger lab entrance timings across 15-minute intervals.",
        "hostels": "Increase electricity load monitoring in residential blocks.",
        "recreation": "Open overflow sports courts. Monitor water station capacity.",
        "gates": "Open secondary entrance gates. Deploy traffic staff.",
        "admin": "Enable digital check-ins to reduce in-person queue."
    }

    for cat, count in category_counts.items():
        threshold = thresholds.get(cat, 300)
        severity = "low"
        if count > threshold * 1.5:
            severity = "critical"
        elif count > threshold:
            severity = "high"
        elif count > threshold * 0.7:
            severity = "medium"

        if severity in ("high", "critical"):
            alerts.append({
                "location": cat.capitalize(),
                "count": count,
                "severity": severity,
                "recommendation": suggestions.get(cat, "Monitor and manage crowd flow."),
                "time": f"{hour:02d}:00"
            })

    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    alerts.sort(key=lambda x: order.get(x["severity"], 4))

    response = {
        "sim_time": sim_time,
        "hour": hour,
        "category_occupancy": category_counts,
        "alerts": alerts,
    }
    if events_applied is not None:
        response["events_applied"] = events_applied

    return response


def _call_llm_for_json(system_prompt: str, user_payload: dict) -> Optional[dict]:
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

    try:
        if provider == "gemini":
            return ai_suggest_gemini(api_key, ai_url, ai_model, system_prompt, user_payload)
        return ai_suggest_openai(api_key, ai_url, ai_model, system_prompt, user_payload)
    except (urllib_error.URLError, urllib_error.HTTPError, TimeoutError, KeyError, IndexError, json.JSONDecodeError, TypeError, ValueError):
        return None


def _fallback_actuation_actions(alerts: List[dict], max_actions: int) -> list[dict]:
    actions = []
    for alert in alerts:
        action = {
            "target": alert.get("location", "Unknown"),
            "severity": alert.get("severity", "medium"),
            "action": alert.get("recommendation", "Monitor and manage crowd flow."),
            "eta_minutes": 10,
            "priority": "p0" if alert.get("severity") == "critical" else "p1",
        }
        actions.append(action)
        if len(actions) >= max(1, max_actions):
            break
    return actions


def _actuation_node_context(state: ActuationState) -> ActuationState:
    category_counts, applied = aggregate_category_counts_with_events(state["sim_time"], [Event(**item) for item in state.get("events", [])])
    congestion = build_congestion_response(state["sim_time"], category_counts, events_applied=applied)

    return {
        "hour": int(state["sim_time"]),
        "category_counts": category_counts,
        "alerts": congestion["alerts"],
        "events_applied": applied,
        "needs_actuation": len(congestion["alerts"]) > 0,
    }


def _actuation_node_control(state: ActuationState) -> ActuationState:
    control_state = {
        "phase": "control_gate",
        "approval_mode": state.get("approval_mode", "manual"),
        "objective": state.get("objective", "minimize_congestion"),
        "hour": state.get("hour", int(state["sim_time"])),
    }
    return {"control_state": control_state}


def _actuation_node_agent(state: ActuationState) -> ActuationState:
    alerts = state.get("alerts", [])
    control_state = state.get("control_state", {})

    if not state.get("needs_actuation"):
        return {
            "agent_state": {
                "status": "no_action_required",
                "reason": "No high or critical congestion alerts for current simulation hour.",
            },
            "decisions": [],
            "decision_source": "rule-based",
        }

    system_prompt = (
        "You are an actuation orchestration agent for a campus digital twin. "
        "Given congestion alerts and control constraints, produce practical control actions. "
        "Return strict JSON only with key 'actions' as an array. "
        "Each action item must include target, action, priority (p0|p1|p2), eta_minutes (integer), rationale."
    )
    user_payload = {
        "objective": state.get("objective", "minimize_congestion"),
        "max_actions": state.get("max_actions", 3),
        "control_state": control_state,
        "alerts": alerts,
        "category_occupancy": state.get("category_counts", {}),
    }

    llm_result = _call_llm_for_json(system_prompt, user_payload)
    actions = []
    if isinstance(llm_result, dict):
        candidate = llm_result.get("actions")
        if isinstance(candidate, list):
            for item in candidate:
                if not isinstance(item, dict):
                    continue
                target = str(item.get("target", "Unknown"))
                action_text = str(item.get("action", "Monitor and manage crowd flow."))
                priority = str(item.get("priority", "p1")).lower()
                if priority not in ("p0", "p1", "p2"):
                    priority = "p1"
                eta = item.get("eta_minutes", 10)
                try:
                    eta_int = max(1, int(eta))
                except (TypeError, ValueError):
                    eta_int = 10
                rationale = str(item.get("rationale", "Congestion mitigation action."))
                actions.append(
                    {
                        "target": target,
                        "action": action_text,
                        "priority": priority,
                        "eta_minutes": eta_int,
                        "rationale": rationale,
                    }
                )

    max_actions = max(1, int(state.get("max_actions", 3)))
    if actions:
        return {
            "agent_state": {
                "status": "actions_generated",
                "reason": "LLM generated actuation actions.",
            },
            "decisions": actions[:max_actions],
            "decision_source": "llm",
        }

    fallback_actions = _fallback_actuation_actions(alerts, max_actions)
    return {
        "agent_state": {
            "status": "fallback_actions_generated",
            "reason": "LLM unavailable or invalid output. Used heuristic fallback.",
        },
        "decisions": fallback_actions,
        "decision_source": "heuristic-fallback",
    }


def _actuation_node_finalize(state: ActuationState) -> ActuationState:
    response = {
        "sim_time": state["sim_time"],
        "hour": state.get("hour", int(state["sim_time"])),
        "objective": state.get("objective", "minimize_congestion"),
        "events_applied": state.get("events_applied", 0),
        "category_occupancy": state.get("category_counts", {}),
        "alerts": state.get("alerts", []),
        "control_state": state.get("control_state", {}),
        "agent_state": state.get("agent_state", {}),
        "decisions": state.get("decisions", []),
        "decision_source": state.get("decision_source", "unknown"),
    }
    return {"response": response}


def run_actuation_graph(payload: ActuationRequest) -> dict:
    initial_state: ActuationState = {
        "sim_time": payload.sim_time,
        "objective": payload.objective,
        "max_actions": payload.max_actions,
        "approval_mode": payload.approval_mode,
        "events": [event.model_dump() for event in payload.events],
    }

    if LANGGRAPH_AVAILABLE:
        graph = StateGraph(ActuationState)
        graph.add_node("context", _actuation_node_context)
        graph.add_node("control", _actuation_node_control)
        graph.add_node("agent", _actuation_node_agent)
        graph.add_node("finalize", _actuation_node_finalize)

        graph.set_entry_point("context")
        graph.add_edge("context", "control")
        graph.add_edge("control", "agent")
        graph.add_edge("agent", "finalize")
        graph.add_edge("finalize", END)

        compiled = graph.compile()
        final_state = compiled.invoke(initial_state)
        response = final_state.get("response", {})
        response["runtime"] = {"orchestrator": "langgraph"}
        return response

    state = initial_state
    state.update(_actuation_node_context(state))
    state.update(_actuation_node_control(state))
    state.update(_actuation_node_agent(state))
    state.update(_actuation_node_finalize(state))
    response = state.get("response", {})
    response["runtime"] = {
        "orchestrator": "linear",
        "note": "Install langgraph for graph orchestration.",
    }
    return response
