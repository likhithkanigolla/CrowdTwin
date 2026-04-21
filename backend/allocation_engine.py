from __future__ import annotations

from datetime import datetime
from itertools import combinations
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4


def _now_iso() -> str:
    return datetime.now().isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def _overlaps(start_a: str, end_a: str, start_b: str, end_b: str) -> bool:
    a_start = datetime.fromisoformat(start_a)
    a_end = datetime.fromisoformat(end_a)
    b_start = datetime.fromisoformat(start_b)
    b_end = datetime.fromisoformat(end_b)
    return a_start < b_end and b_start < a_end


def _clamp(value: float, lower: float = 0.0, upper: float = 100.0) -> float:
    return max(lower, min(upper, value))


sites_store: Dict[str, Dict[str, Any]] = {}
buildings_store: Dict[str, Dict[str, Any]] = {}
rooms_store: Dict[str, Dict[str, Any]] = {}
facility_types_store: Dict[str, Dict[str, Any]] = {}
room_facilities_store: Dict[str, List[Dict[str, Any]]] = {}
room_proximities_store: Dict[str, List[Dict[str, Any]]] = {}
event_types_store: Dict[str, Dict[str, Any]] = {}
event_profiles_store: Dict[str, Dict[str, Any]] = {}
bookings_store: Dict[str, Dict[str, Any]] = {}
booking_rooms_store: Dict[str, List[Dict[str, Any]]] = {}
occupancy_signals_store: Dict[str, List[Dict[str, Any]]] = {}
allocation_runs_store: Dict[str, Dict[str, Any]] = {}
allocation_candidates_store: Dict[str, List[Dict[str, Any]]] = {}
manual_overrides_store: Dict[str, Dict[str, Any]] = {}


DEFAULT_WEIGHTS = {
    "capacity_fit": 0.18,
    "facility_count": 0.18,
    "facility_distance": 0.13,
    "safety": 0.15,
    "occupancy_risk": 0.12,
    "accessibility": 0.09,
    "operational_convenience": 0.1,
    "cost": 0.05,
}


PRIORITY_PRESETS = {
    "balanced": DEFAULT_WEIGHTS,
    "safety-first": {
        **DEFAULT_WEIGHTS,
        "safety": 0.25,
        "occupancy_risk": 0.16,
        "cost": 0.02,
        "operational_convenience": 0.08,
    },
    "convenience-first": {
        **DEFAULT_WEIGHTS,
        "operational_convenience": 0.2,
        "facility_distance": 0.18,
        "safety": 0.11,
        "cost": 0.03,
    },
}


def reset_allocation_stores() -> None:
    stores = [
        sites_store,
        buildings_store,
        rooms_store,
        facility_types_store,
        room_facilities_store,
        room_proximities_store,
        event_types_store,
        event_profiles_store,
        bookings_store,
        booking_rooms_store,
        occupancy_signals_store,
        allocation_runs_store,
        allocation_candidates_store,
        manual_overrides_store,
    ]
    for store in stores:
        store.clear()


def _facility_key_to_id() -> Dict[str, str]:
    return {v["key"]: k for k, v in facility_types_store.items()}


def ensure_default_facility_types() -> None:
    if facility_types_store:
        return

    defs = [
        ("water_cooler", "Water Cooler", "count"),
        ("washroom", "Washroom", "count"),
        ("emergency_exit", "Emergency Exit", "count"),
        ("fire_safety", "Fire Safety", "boolean"),
        ("accessibility", "Accessibility", "boolean"),
        ("medical_point", "Medical Point", "distance"),
        ("security_staff", "Security Staff", "count"),
        ("av_setup", "AV Setup", "boolean"),
        ("power_backup", "Power Backup", "boolean"),
        ("controlled_entry", "Controlled Entry", "boolean"),
    ]

    for key, name, unit_type in defs:
        fid = _new_id("facility")
        facility_types_store[fid] = {
            "id": fid,
            "key": key,
            "name": name,
            "unitType": unit_type,
            "createdAt": _now_iso(),
        }


def _tier_for_attendance(profile: Dict[str, Any], attendance: int) -> Dict[str, Any]:
    tiers = profile.get("configJson", {}).get("attendance_tiers", [])
    for tier in tiers:
        min_a = int(tier.get("min_attendance", 0))
        max_a = int(tier.get("max_attendance", 10**9))
        if min_a <= attendance <= max_a:
            return tier
    return tiers[-1] if tiers else {"requirements": []}


def _resolve_requirements(profile: Dict[str, Any], attendance: int) -> List[Dict[str, Any]]:
    tier = _tier_for_attendance(profile, attendance)
    reqs = list(tier.get("requirements", []))
    base = profile.get("configJson", {}).get("base_requirements", [])
    reqs.extend(base)
    return reqs


def _resolve_profile_and_type(event_type_id: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    event_type = event_types_store.get(event_type_id)
    if not event_type:
        raise ValueError("Unknown event type")

    profile = next((p for p in event_profiles_store.values() if p["eventTypeId"] == event_type_id), None)
    if not profile:
        raise ValueError("No profile configured for event type")

    return event_type, profile


def create_site(payload: Dict[str, Any]) -> Dict[str, Any]:
    sid = _new_id("site")
    site = {
        "id": sid,
        "name": payload["name"],
        "geoBoundary": payload.get("geoBoundary"),
        "createdAt": _now_iso(),
    }
    sites_store[sid] = site
    return site


def create_building(payload: Dict[str, Any]) -> Dict[str, Any]:
    site_id = payload["siteId"]
    if site_id not in sites_store:
        raise ValueError("Unknown siteId")

    bid = _new_id("building")
    building = {
        "id": bid,
        "siteId": site_id,
        "name": payload["name"],
        "location": payload.get("location"),
        "createdAt": _now_iso(),
    }
    buildings_store[bid] = building
    return building


def create_room(payload: Dict[str, Any]) -> Dict[str, Any]:
    building_id = payload["buildingId"]
    if building_id not in buildings_store:
        raise ValueError("Unknown buildingId")

    rid = _new_id("room")
    room = {
        "id": rid,
        "buildingId": building_id,
        "name": payload["name"],
        "floor": payload.get("floor", "NA"),
        "capacity": int(payload["capacity"]),
        "roomType": payload.get("roomType", "general"),
        "status": payload.get("status", "available"),
        "accessibilityScore": float(payload.get("accessibilityScore", 0.7)),
        "estimatedCost": float(payload.get("estimatedCost", 0.0)),
        "createdAt": _now_iso(),
    }
    rooms_store[rid] = room
    room_facilities_store[rid] = []
    room_proximities_store[rid] = []
    return room


def upsert_room_facilities(room_id: str, facilities: List[Dict[str, Any]], proximities: List[Dict[str, Any]]) -> Dict[str, Any]:
    if room_id not in rooms_store:
        raise ValueError("Unknown room")

    for item in facilities:
        facility_type_id = item["facilityTypeId"]
        if facility_type_id not in facility_types_store:
            raise ValueError(f"Unknown facilityTypeId: {facility_type_id}")

    for item in proximities:
        facility_type_id = item["facilityTypeId"]
        if facility_type_id not in facility_types_store:
            raise ValueError(f"Unknown facilityTypeId: {facility_type_id}")

    room_facilities_store[room_id] = [
        {
            "id": _new_id("roomfac"),
            "roomId": room_id,
            "facilityTypeId": item["facilityTypeId"],
            "count": int(item.get("count", 0)),
            "metadata": item.get("metadata") or {},
        }
        for item in facilities
    ]

    room_proximities_store[room_id] = [
        {
            "id": _new_id("roomprox"),
            "roomId": room_id,
            "facilityTypeId": item["facilityTypeId"],
            "nearestDistanceMeters": float(item["nearestDistanceMeters"]),
        }
        for item in proximities
    ]

    return {
        "roomId": room_id,
        "facilities": room_facilities_store[room_id],
        "proximities": room_proximities_store[room_id],
    }


def create_event_type(payload: Dict[str, Any]) -> Dict[str, Any]:
    eid = _new_id("eventtype")
    row = {
        "id": eid,
        "name": payload["name"],
        "isCustom": bool(payload.get("isCustom", False)),
        "createdAt": _now_iso(),
    }
    event_types_store[eid] = row
    return row


def create_event_profile(payload: Dict[str, Any]) -> Dict[str, Any]:
    event_type_id = payload["eventTypeId"]
    if event_type_id not in event_types_store:
        raise ValueError("Unknown eventTypeId")

    existing = next((p for p in event_profiles_store.values() if p["eventTypeId"] == event_type_id), None)
    if existing:
        existing["configJson"] = payload["configJson"]
        existing["updatedAt"] = _now_iso()
        return existing

    pid = _new_id("profile")
    row = {
        "id": pid,
        "eventTypeId": event_type_id,
        "configJson": payload["configJson"],
        "createdAt": _now_iso(),
    }
    event_profiles_store[pid] = row
    return row


def create_booking(payload: Dict[str, Any]) -> Dict[str, Any]:
    if payload["eventTypeId"] not in event_types_store:
        raise ValueError("Unknown eventTypeId")

    bid = _new_id("booking")
    booking = {
        "id": bid,
        "eventName": payload["eventName"],
        "eventTypeId": payload["eventTypeId"],
        "expectedAttendance": int(payload["expectedAttendance"]),
        "startAt": payload["startAt"],
        "endAt": payload["endAt"],
        "siteScope": payload.get("siteScope", []),
        "buildingScope": payload.get("buildingScope", []),
        "status": payload.get("status", "pending"),
        "createdAt": _now_iso(),
    }
    bookings_store[bid] = booking
    booking_rooms_store[bid] = []
    return booking


def create_occupancy_signal(payload: Dict[str, Any]) -> Dict[str, Any]:
    room_id = payload["roomId"]
    if room_id not in rooms_store:
        raise ValueError("Unknown roomId")

    row = {
        "id": _new_id("occupancy"),
        "roomId": room_id,
        "ts": payload.get("ts") or _now_iso(),
        "currentOccupancy": int(payload.get("currentOccupancy", 0)),
        "predictedOccupancy": int(payload.get("predictedOccupancy", 0)),
        "confidence": float(payload.get("confidence", 0.8)),
    }
    occupancy_signals_store.setdefault(room_id, []).append(row)
    return row


def _latest_occupancy(room_id: str) -> Dict[str, Any]:
    rows = occupancy_signals_store.get(room_id, [])
    if not rows:
        return {"currentOccupancy": 0, "predictedOccupancy": 0, "confidence": 0.0}
    return rows[-1]


def _room_facility_map(room_ids: List[str]) -> Dict[str, int]:
    totals: Dict[str, int] = {}
    for room_id in room_ids:
        for row in room_facilities_store.get(room_id, []):
            key = row["facilityTypeId"]
            totals[key] = totals.get(key, 0) + int(row.get("count", 0))
            if facility_types_store.get(key, {}).get("unitType") == "boolean" and row.get("count", 0) > 0:
                totals[key] = max(1, totals[key])
    return totals


def _room_proximity_map(room_ids: List[str]) -> Dict[str, float]:
    best: Dict[str, float] = {}
    for room_id in room_ids:
        for row in room_proximities_store.get(room_id, []):
            key = row["facilityTypeId"]
            dist = float(row.get("nearestDistanceMeters", 10**9))
            if key not in best or dist < best[key]:
                best[key] = dist
    return best


def _booking_conflicts(room_ids: List[str], booking: Dict[str, Any]) -> List[str]:
    conflicts: List[str] = []
    for existing_id, existing in bookings_store.items():
        if existing_id == booking["id"]:
            continue
        if existing.get("status") in {"cancelled", "completed"}:
            continue
        if not _overlaps(booking["startAt"], booking["endAt"], existing["startAt"], existing["endAt"]):
            continue
        booked_room_ids = {item["roomId"] for item in booking_rooms_store.get(existing_id, [])}
        overlap = booked_room_ids.intersection(set(room_ids))
        if overlap:
            conflicts.append(f"Time conflict with booking {existing_id} on rooms: {sorted(overlap)}")
    return conflicts


def _safety_violations(room_ids: List[str], occupancy_threshold: float) -> List[str]:
    violations: List[str] = []
    for room_id in room_ids:
        room = rooms_store[room_id]
        occupancy = _latest_occupancy(room_id)
        predicted = int(occupancy.get("predictedOccupancy", 0))
        if room["capacity"] > 0 and predicted / room["capacity"] > occupancy_threshold:
            violations.append(
                f"Occupancy safety threshold exceeded in room {room['name']} ({predicted}/{room['capacity']})"
            )

    facility_map = _room_facility_map(room_ids)
    key_to_id = _facility_key_to_id()
    for required_key in ["emergency_exit", "fire_safety"]:
        facility_id = key_to_id.get(required_key)
        if facility_id and facility_map.get(facility_id, 0) <= 0:
            violations.append(f"Missing safety facility: {required_key}")

    return violations


def _legal_checks(
    room_ids: List[str],
    booking: Dict[str, Any],
    profile: Dict[str, Any],
) -> List[str]:
    rules = profile.get("configJson", {}).get("legal_rules", {})
    violations: List[str] = []

    min_exit_per_people = float(rules.get("min_emergency_exit_per_200", 1))
    max_people_per_washroom = int(rules.get("max_people_per_washroom", 120))

    facility_map = _room_facility_map(room_ids)
    key_to_id = _facility_key_to_id()
    exit_count = facility_map.get(key_to_id.get("emergency_exit", ""), 0)
    washroom_count = facility_map.get(key_to_id.get("washroom", ""), 0)

    required_exits = max(1, int((booking["expectedAttendance"] / 200.0) * min_exit_per_people + 0.9999))
    if exit_count < required_exits:
        violations.append(f"Legal: required emergency exits={required_exits}, available={exit_count}")

    if washroom_count <= 0 or booking["expectedAttendance"] / washroom_count > max_people_per_washroom:
        violations.append(
            f"Legal: washroom ratio exceeded ({booking['expectedAttendance']} attendees, washrooms={washroom_count})"
        )

    return violations


def _hard_filter(
    room_ids: List[str],
    booking: Dict[str, Any],
    profile: Dict[str, Any],
    compliance_mode: str,
) -> Tuple[bool, List[str], List[str]]:
    reasons: List[str] = []
    warnings: List[str] = []

    max_unavailable = [rooms_store[r]["name"] for r in room_ids if rooms_store[r].get("status") != "available"]
    if max_unavailable:
        reasons.append(f"Unavailable rooms: {max_unavailable}")

    requirements = _resolve_requirements(profile, int(booking["expectedAttendance"]))
    safety_buffer = float(profile.get("configJson", {}).get("capacity_buffer", 1.1))
    required_capacity = int(booking["expectedAttendance"] * safety_buffer + 0.9999)
    available_capacity = sum(int(rooms_store[r]["capacity"]) for r in room_ids)
    if available_capacity < required_capacity:
        reasons.append(f"Capacity shortfall: required={required_capacity}, available={available_capacity}")

    conflicts = _booking_conflicts(room_ids, booking)
    reasons.extend(conflicts)

    facility_map = _room_facility_map(room_ids)
    proximity_map = _room_proximity_map(room_ids)

    for req in requirements:
        ftid = req["facilityTypeId"]
        min_count = int(req.get("minCount", 0))
        max_dist = req.get("maxDistanceMeters")
        mandatory = bool(req.get("mandatory", False))

        available_count = facility_map.get(ftid, 0)
        if mandatory and available_count < min_count:
            reasons.append(
                f"Missing mandatory facility {facility_types_store.get(ftid, {}).get('key', ftid)}: required={min_count}, available={available_count}"
            )

        if max_dist is not None:
            available_distance = proximity_map.get(ftid)
            if available_distance is None:
                if mandatory:
                    reasons.append(
                        f"No proximity data for mandatory facility {facility_types_store.get(ftid, {}).get('key', ftid)}"
                    )
            elif available_distance > float(max_dist):
                msg = (
                    f"Distance constraint failed for {facility_types_store.get(ftid, {}).get('key', ftid)}: "
                    f"limit={max_dist}m, nearest={available_distance:.1f}m"
                )
                if mandatory:
                    reasons.append(msg)
                else:
                    warnings.append(msg)

    occupancy_threshold = float(profile.get("configJson", {}).get("occupancy_threshold", 0.9))
    reasons.extend(_safety_violations(room_ids, occupancy_threshold))

    legal_violations = _legal_checks(room_ids, booking, profile)
    if legal_violations:
        if compliance_mode == "STRICT":
            reasons.extend(legal_violations)
        else:
            warnings.extend(legal_violations)

    return (len(reasons) == 0), reasons, warnings


def _score_candidate(
    room_ids: List[str],
    booking: Dict[str, Any],
    profile: Dict[str, Any],
    priority_preset: str,
) -> Dict[str, float]:
    requirements = _resolve_requirements(profile, int(booking["expectedAttendance"]))
    weights = PRIORITY_PRESETS.get(priority_preset, PRIORITY_PRESETS["balanced"])

    total_capacity = sum(int(rooms_store[r]["capacity"]) for r in room_ids)
    required = max(1, int(booking["expectedAttendance"]))
    utilization = required / max(1, total_capacity)
    capacity_fit = _clamp(100 - abs(0.85 - utilization) * 120)

    facility_map = _room_facility_map(room_ids)
    proximity_map = _room_proximity_map(room_ids)

    count_scores: List[float] = []
    distance_scores: List[float] = []
    weighted_safety = []

    for req in requirements:
        ftid = req["facilityTypeId"]
        min_count = max(1, int(req.get("minCount", 1)))
        weight = float(req.get("weight", 1.0))
        have_count = facility_map.get(ftid, 0)
        count_scores.append(_clamp((have_count / min_count) * 100))

        max_dist = req.get("maxDistanceMeters")
        if max_dist is not None:
            nearest = proximity_map.get(ftid, float(max_dist) * 2)
            distance_scores.append(_clamp(100 - ((nearest - float(max_dist)) / max(1.0, float(max_dist))) * 100))

        if facility_types_store.get(ftid, {}).get("key") in {"emergency_exit", "fire_safety", "medical_point"}:
            weighted_safety.append((_clamp((have_count / min_count) * 100), weight))

    facility_count_score = sum(count_scores) / len(count_scores) if count_scores else 80.0
    facility_distance_score = sum(distance_scores) / len(distance_scores) if distance_scores else 75.0

    if weighted_safety:
        safety_score = sum(score * weight for score, weight in weighted_safety) / sum(weight for _, weight in weighted_safety)
    else:
        safety_score = 75.0

    occupancies = [_latest_occupancy(r) for r in room_ids]
    occ_ratios = []
    for idx, room_id in enumerate(room_ids):
        room_cap = max(1, int(rooms_store[room_id]["capacity"]))
        pred = int(occupancies[idx].get("predictedOccupancy", 0))
        occ_ratios.append(pred / room_cap)
    occupancy_risk = _clamp(100 - (sum(occ_ratios) / max(1, len(occ_ratios))) * 100)

    accessibility_score = _clamp(
        sum(float(rooms_store[r].get("accessibilityScore", 0.7)) for r in room_ids) / max(1, len(room_ids)) * 100
    )

    building_ids = [rooms_store[r]["buildingId"] for r in room_ids]
    same_building_bonus = 100.0 if len(set(building_ids)) == 1 else 70.0
    fragmentation_penalty = _clamp(100 - (len(room_ids) - 1) * 15)
    operational_convenience = _clamp((same_building_bonus + fragmentation_penalty) / 2)

    avg_cost = sum(float(rooms_store[r].get("estimatedCost", 0.0)) for r in room_ids) / max(1, len(room_ids))
    cost_score = _clamp(100 - avg_cost)

    total = (
        capacity_fit * weights["capacity_fit"]
        + facility_count_score * weights["facility_count"]
        + facility_distance_score * weights["facility_distance"]
        + safety_score * weights["safety"]
        + occupancy_risk * weights["occupancy_risk"]
        + accessibility_score * weights["accessibility"]
        + operational_convenience * weights["operational_convenience"]
        + cost_score * weights["cost"]
    )

    return {
        "capacity_score": round(capacity_fit, 2),
        "facility_score": round(facility_count_score, 2),
        "distance_score": round(facility_distance_score, 2),
        "safety_score": round(safety_score, 2),
        "occupancy_score": round(occupancy_risk, 2),
        "accessibility_score": round(accessibility_score, 2),
        "operational_score": round(operational_convenience, 2),
        "cost_score": round(cost_score, 2),
        "final_score": round(_clamp(total), 2),
    }


def _candidate_room_sets(room_ids: List[str], max_rooms: int = 3) -> List[List[str]]:
    single = [[rid] for rid in room_ids]
    combos: List[List[str]] = []
    for size in range(2, max_rooms + 1):
        combos.extend([list(combo) for combo in combinations(room_ids, size)])
    return single + combos


def _eligible_rooms(booking: Dict[str, Any]) -> List[str]:
    room_ids = list(rooms_store.keys())
    site_scope = set(booking.get("siteScope") or [])
    building_scope = set(booking.get("buildingScope") or [])

    filtered: List[str] = []
    for rid in room_ids:
        room = rooms_store[rid]
        building = buildings_store.get(room["buildingId"]) or {}

        if site_scope and building.get("siteId") not in site_scope:
            continue
        if building_scope and room.get("buildingId") not in building_scope:
            continue
        filtered.append(rid)

    return filtered


def run_allocation(payload: Dict[str, Any]) -> Dict[str, Any]:
    compliance_mode = payload.get("complianceMode", "ADVISORY")
    priority_preset = payload.get("priorityPreset", "balanced")
    max_rooms = int(payload.get("maxRooms", 3))

    booking: Optional[Dict[str, Any]] = None
    booking_id = payload.get("bookingId")
    if booking_id:
        booking = bookings_store.get(booking_id)
    else:
        if payload.get("eventTypeId") is None:
            custom_name = (payload.get("customEventType") or "Custom Event").strip()
            custom_event = create_event_type({"name": custom_name, "isCustom": True})
            if payload.get("eventProfileConfig"):
                create_event_profile({"eventTypeId": custom_event["id"], "configJson": payload["eventProfileConfig"]})
            payload["eventTypeId"] = custom_event["id"]

        booking = create_booking({
            "eventName": payload.get("eventName", "Adhoc Event"),
            "eventTypeId": payload["eventTypeId"],
            "expectedAttendance": payload["expectedAttendance"],
            "startAt": payload["startAt"],
            "endAt": payload["endAt"],
            "siteScope": payload.get("siteScope", []),
            "buildingScope": payload.get("buildingScope", []),
            "status": "pending",
        })

    if not booking:
        raise ValueError("Booking not found")

    _, profile = _resolve_profile_and_type(booking["eventTypeId"])

    run_id = _new_id("allocrun")
    run = {
        "id": run_id,
        "bookingId": booking["id"],
        "mode": compliance_mode,
        "requestedBy": payload.get("requestedBy", "system"),
        "createdAt": _now_iso(),
        "decisionJson": {},
    }
    allocation_runs_store[run_id] = run

    eligible = _eligible_rooms(booking)
    candidate_sets = _candidate_room_sets(eligible, max_rooms=max_rooms)

    passed: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []

    for room_set in candidate_sets:
        hard_pass, reasons, warnings = _hard_filter(room_set, booking, profile, compliance_mode)
        candidate = {
            "id": _new_id("alloccand"),
            "runId": run_id,
            "candidateKey": "+".join(sorted(room_set)),
            "roomSetJson": room_set,
            "hardPass": hard_pass,
            "scoresJson": {},
            "reasonsJson": {
                "hard_fail_reasons": reasons,
                "advisory_warnings": warnings,
                "tradeoffs": [],
            },
        }

        if hard_pass:
            scores = _score_candidate(room_set, booking, profile, priority_preset)
            candidate["scoresJson"] = scores
            if len(room_set) > 1:
                candidate["reasonsJson"]["tradeoffs"].append(
                    "Uses multiple rooms; improves capacity but adds operational complexity"
                )
            passed.append(candidate)
        else:
            failed.append(candidate)

    passed.sort(key=lambda c: c["scoresJson"].get("final_score", 0.0), reverse=True)

    allocation_candidates_store[run_id] = passed + failed

    unmet: List[str] = []
    if not passed:
        unmet = sorted({reason for c in failed for reason in c["reasonsJson"]["hard_fail_reasons"]})

    recommended = passed[0] if passed else None
    if recommended:
        booking_rooms_store[booking["id"]] = [
            {
                "id": _new_id("bookingroom"),
                "bookingId": booking["id"],
                "roomId": rid,
                "allocatedCapacity": int(rooms_store[rid]["capacity"]),
            }
            for rid in recommended["roomSetJson"]
        ]

    decision = {
        "recommendedCandidate": recommended,
        "rankedCandidates": passed[:10],
        "failedCandidatesSummary": failed[:20],
        "unmetRequirements": unmet,
        "nearestRelaxations": [
            "Increase maxRooms by 1",
            "Switch complianceMode to ADVISORY",
            "Reduce minimum attendance buffer",
        ] if not passed else [],
        "auditMetadata": {
            "constraints_used": {
                "compliance_mode": compliance_mode,
                "priority_preset": priority_preset,
                "max_rooms": max_rooms,
            },
            "candidate_count": len(candidate_sets),
            "passed_count": len(passed),
            "failed_count": len(failed),
            "profile_id": profile["id"],
        },
    }
    allocation_runs_store[run_id]["decisionJson"] = decision

    return {
        "runId": run_id,
        **decision,
    }


def get_allocation_run(run_id: str) -> Dict[str, Any]:
    run = allocation_runs_store.get(run_id)
    if not run:
        raise ValueError("Allocation run not found")
    return {
        "runId": run_id,
        "run": run,
        **(run.get("decisionJson") or {}),
        "manualOverride": manual_overrides_store.get(run_id),
    }


def manual_override(run_id: str, chosen_candidate_key: str, overridden_by: str, reason: str) -> Dict[str, Any]:
    run = allocation_runs_store.get(run_id)
    if not run:
        raise ValueError("Allocation run not found")

    candidates = allocation_candidates_store.get(run_id, [])
    chosen = next((c for c in candidates if c["candidateKey"] == chosen_candidate_key), None)
    if not chosen:
        raise ValueError("Candidate key not found in run")

    override = {
        "id": _new_id("override"),
        "runId": run_id,
        "chosenCandidateKey": chosen_candidate_key,
        "overriddenBy": overridden_by,
        "reason": reason,
        "timestamp": _now_iso(),
        "candidateSnapshot": chosen,
    }
    manual_overrides_store[run_id] = override

    booking_id = run["bookingId"]
    booking_rooms_store[booking_id] = [
        {
            "id": _new_id("bookingroom"),
            "bookingId": booking_id,
            "roomId": rid,
            "allocatedCapacity": int(rooms_store[rid]["capacity"]),
        }
        for rid in chosen["roomSetJson"]
    ]

    return override


def _requirement(ftid: str, min_count: int, max_distance: Optional[float], mandatory: bool, weight: float) -> Dict[str, Any]:
    return {
        "facilityTypeId": ftid,
        "minCount": min_count,
        "maxDistanceMeters": max_distance,
        "mandatory": mandatory,
        "weight": weight,
    }


def seed_default_data(force: bool = False) -> Dict[str, Any]:
    if (sites_store or buildings_store or rooms_store) and not force:
        return {
            "seeded": False,
            "reason": "stores-not-empty",
            "counts": {
                "sites": len(sites_store),
                "buildings": len(buildings_store),
                "rooms": len(rooms_store),
            },
        }

    if force:
        reset_allocation_stores()

    ensure_default_facility_types()
    key_to_id = _facility_key_to_id()

    site_north = create_site({"name": "North Campus", "geoBoundary": {"type": "Polygon"}})
    site_south = create_site({"name": "South Campus", "geoBoundary": {"type": "Polygon"}})

    b1 = create_building({"siteId": site_north["id"], "name": "Main Academic Block", "location": {"lat": 17.4470, "lng": 78.3480}})
    b2 = create_building({"siteId": site_north["id"], "name": "Convention Center", "location": {"lat": 17.4478, "lng": 78.3492}})
    b3 = create_building({"siteId": site_south["id"], "name": "Innovation Hub", "location": {"lat": 17.4455, "lng": 78.3471}})
    b4 = create_building({"siteId": site_south["id"], "name": "Cultural Arena", "location": {"lat": 17.4448, "lng": 78.3465}})

    created_rooms: List[Dict[str, Any]] = []
    room_specs = [
        (b1["id"], "MA-101", 120, "lecture"),
        (b1["id"], "MA-201", 180, "lecture"),
        (b1["id"], "MA-Hall", 260, "auditorium"),
        (b2["id"], "CC-Auditorium", 450, "auditorium"),
        (b2["id"], "CC-Meeting-1", 90, "conference"),
        (b2["id"], "CC-Meeting-2", 110, "conference"),
        (b3["id"], "IH-Forum", 220, "conference"),
        (b3["id"], "IH-LabHall", 160, "lab"),
        (b3["id"], "IH-Cafe-Hall", 130, "multipurpose"),
        (b4["id"], "CA-Stage", 500, "arena"),
        (b4["id"], "CA-Green-1", 140, "open"),
        (b4["id"], "CA-Green-2", 140, "open"),
    ]

    for building_id, name, capacity, room_type in room_specs:
        room = create_room({
            "buildingId": building_id,
            "name": name,
            "capacity": capacity,
            "roomType": room_type,
            "status": "available",
            "accessibilityScore": 0.55 if "Green" in name else 0.78,
            "estimatedCost": 15 + (capacity / 20),
        })
        created_rooms.append(room)

    for idx, room in enumerate(created_rooms):
        cap = int(room["capacity"])
        facilities = [
            {"facilityTypeId": key_to_id["washroom"], "count": max(1, cap // 120), "metadata": {}},
            {"facilityTypeId": key_to_id["water_cooler"], "count": max(1, cap // 100), "metadata": {}},
            {"facilityTypeId": key_to_id["emergency_exit"], "count": max(1, cap // 180), "metadata": {}},
            {"facilityTypeId": key_to_id["fire_safety"], "count": 1, "metadata": {}},
            {"facilityTypeId": key_to_id["accessibility"], "count": 1 if "Green" not in room["name"] else 0, "metadata": {}},
            {"facilityTypeId": key_to_id["medical_point"], "count": 1, "metadata": {}},
            {"facilityTypeId": key_to_id["power_backup"], "count": 1, "metadata": {}},
            {"facilityTypeId": key_to_id["security_staff"], "count": max(1, cap // 220), "metadata": {}},
        ]

        if any(token in room["name"] for token in ["Auditorium", "Forum", "Hall", "Stage", "Meeting"]):
            facilities.append({"facilityTypeId": key_to_id["av_setup"], "count": 1, "metadata": {}})
        if "Stage" in room["name"] or "Arena" in room["roomType"]:
            facilities.append({"facilityTypeId": key_to_id["controlled_entry"], "count": 1, "metadata": {}})

        proximities = [
            {"facilityTypeId": key_to_id["washroom"], "nearestDistanceMeters": 15 + (idx % 6) * 5},
            {"facilityTypeId": key_to_id["water_cooler"], "nearestDistanceMeters": 10 + (idx % 4) * 6},
            {"facilityTypeId": key_to_id["medical_point"], "nearestDistanceMeters": 35 + (idx % 5) * 12},
            {"facilityTypeId": key_to_id["emergency_exit"], "nearestDistanceMeters": 8 + (idx % 3) * 4},
        ]

        upsert_room_facilities(room["id"], facilities, proximities)

        create_occupancy_signal({
            "roomId": room["id"],
            "currentOccupancy": max(5, cap // 6),
            "predictedOccupancy": max(8, cap // 4),
            "confidence": 0.8,
        })
        create_occupancy_signal({
            "roomId": room["id"],
            "currentOccupancy": max(5, cap // 3),
            "predictedOccupancy": max(8, cap // 2),
            "confidence": 0.75,
        })

    concert = create_event_type({"name": "Concert", "isCustom": False})
    conference = create_event_type({"name": "Conference", "isCustom": False})
    club = create_event_type({"name": "Club Event", "isCustom": False})

    create_event_profile({
        "eventTypeId": concert["id"],
        "configJson": {
            "capacity_buffer": 1.15,
            "occupancy_threshold": 0.88,
            "attendance_tiers": [
                {
                    "min_attendance": 1,
                    "max_attendance": 200,
                    "requirements": [
                        _requirement(key_to_id["washroom"], 2, 40, True, 1.2),
                        _requirement(key_to_id["water_cooler"], 2, 35, True, 1.0),
                        _requirement(key_to_id["emergency_exit"], 2, 25, True, 1.5),
                        _requirement(key_to_id["medical_point"], 1, 120, True, 1.2),
                        _requirement(key_to_id["security_staff"], 2, None, True, 1.1),
                    ],
                },
                {
                    "min_attendance": 201,
                    "max_attendance": 5000,
                    "requirements": [
                        _requirement(key_to_id["washroom"], 4, 45, True, 1.3),
                        _requirement(key_to_id["water_cooler"], 4, 35, True, 1.0),
                        _requirement(key_to_id["emergency_exit"], 3, 25, True, 1.6),
                        _requirement(key_to_id["medical_point"], 1, 100, True, 1.4),
                        _requirement(key_to_id["controlled_entry"], 1, None, False, 0.8),
                    ],
                },
            ],
            "legal_rules": {
                "min_emergency_exit_per_200": 1,
                "max_people_per_washroom": 110,
            },
        },
    })

    create_event_profile({
        "eventTypeId": conference["id"],
        "configJson": {
            "capacity_buffer": 1.08,
            "occupancy_threshold": 0.9,
            "attendance_tiers": [
                {
                    "min_attendance": 1,
                    "max_attendance": 5000,
                    "requirements": [
                        _requirement(key_to_id["washroom"], 2, 50, True, 1.0),
                        _requirement(key_to_id["av_setup"], 1, None, True, 1.5),
                        _requirement(key_to_id["accessibility"], 1, None, True, 1.3),
                        _requirement(key_to_id["power_backup"], 1, None, False, 0.8),
                        _requirement(key_to_id["water_cooler"], 2, 45, False, 0.7),
                    ],
                }
            ],
            "legal_rules": {
                "min_emergency_exit_per_200": 1,
                "max_people_per_washroom": 130,
            },
        },
    })

    create_event_profile({
        "eventTypeId": club["id"],
        "configJson": {
            "capacity_buffer": 1.1,
            "occupancy_threshold": 0.85,
            "attendance_tiers": [
                {
                    "min_attendance": 1,
                    "max_attendance": 5000,
                    "requirements": [
                        _requirement(key_to_id["security_staff"], 3, None, True, 1.4),
                        _requirement(key_to_id["controlled_entry"], 1, None, True, 1.2),
                        _requirement(key_to_id["washroom"], 2, 40, True, 1.0),
                        _requirement(key_to_id["emergency_exit"], 2, 25, True, 1.4),
                    ],
                }
            ],
            "legal_rules": {
                "min_emergency_exit_per_200": 1,
                "max_people_per_washroom": 120,
            },
        },
    })

    demo_booking = create_booking({
        "eventName": "Existing Conference Booking",
        "eventTypeId": conference["id"],
        "expectedAttendance": 100,
        "startAt": "2026-04-21T10:00:00",
        "endAt": "2026-04-21T12:00:00",
        "siteScope": [],
        "buildingScope": [],
        "status": "confirmed",
    })
    booking_rooms_store[demo_booking["id"]] = [
        {
            "id": _new_id("bookingroom"),
            "bookingId": demo_booking["id"],
            "roomId": created_rooms[4]["id"],
            "allocatedCapacity": created_rooms[4]["capacity"],
        }
    ]

    return {
        "seeded": True,
        "counts": {
            "sites": len(sites_store),
            "buildings": len(buildings_store),
            "rooms": len(rooms_store),
            "facilityTypes": len(facility_types_store),
            "eventTypes": len(event_types_store),
            "eventProfiles": len(event_profiles_store),
            "bookings": len(bookings_store),
        },
    }
