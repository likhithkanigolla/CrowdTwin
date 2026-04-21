from allocation_engine import (
    reset_allocation_stores,
    seed_default_data,
    event_types_store,
    rooms_store,
    facility_types_store,
    upsert_room_facilities,
    run_allocation,
    manual_override,
    get_allocation_run,
)


def setup_function() -> None:
    reset_allocation_stores()
    seed_default_data(force=True)


def _event_type_id(name: str) -> str:
    return next(item["id"] for item in event_types_store.values() if item["name"] == name)


def _room_id(name: str) -> str:
    return next(item["id"] for item in rooms_store.values() if item["name"] == name)


def _facility_id(key: str) -> str:
    return next(item["id"] for item in facility_types_store.values() if item["key"] == key)


def test_concert_fails_when_washroom_distance_bad() -> None:
    room_id = _room_id("CC-Auditorium")
    washroom_type = _facility_id("washroom")

    upsert_room_facilities(
        room_id,
        facilities=[{"facilityTypeId": washroom_type, "count": 1, "metadata": {}}],
        proximities=[{"facilityTypeId": washroom_type, "nearestDistanceMeters": 300.0}],
    )

    result = run_allocation(
        {
            "eventName": "Campus Concert",
            "eventTypeId": _event_type_id("Concert"),
            "expectedAttendance": 220,
            "startAt": "2026-04-21T16:00:00",
            "endAt": "2026-04-21T19:00:00",
            "complianceMode": "STRICT",
            "priorityPreset": "safety-first",
            "maxRooms": 1,
            "buildingScope": [rooms_store[room_id]["buildingId"]],
        }
    )

    assert result["recommendedCandidate"] is None
    assert result["unmetRequirements"]


def test_conference_passes_and_returns_ranked_candidates() -> None:
    result = run_allocation(
        {
            "eventName": "AI Conference",
            "eventTypeId": _event_type_id("Conference"),
            "expectedAttendance": 140,
            "startAt": "2026-04-22T09:00:00",
            "endAt": "2026-04-22T12:00:00",
            "complianceMode": "ADVISORY",
            "priorityPreset": "balanced",
        }
    )
    assert result["recommendedCandidate"] is not None
    assert len(result["rankedCandidates"]) >= 1


def test_club_event_prefers_security_spaces() -> None:
    result = run_allocation(
        {
            "eventName": "DJ Night",
            "eventTypeId": _event_type_id("Club Event"),
            "expectedAttendance": 180,
            "startAt": "2026-04-23T18:00:00",
            "endAt": "2026-04-23T22:00:00",
            "complianceMode": "ADVISORY",
            "priorityPreset": "safety-first",
        }
    )
    assert result["recommendedCandidate"] is not None
    room_set = result["recommendedCandidate"]["roomSetJson"]
    names = [rooms_store[r]["name"] for r in room_set]
    assert any("Stage" in name or "Hall" in name for name in names)


def test_multi_room_split_for_large_attendance() -> None:
    result = run_allocation(
        {
            "eventName": "Mega Fest",
            "eventTypeId": _event_type_id("Concert"),
                "expectedAttendance": 620,
            "startAt": "2026-04-24T10:00:00",
            "endAt": "2026-04-24T15:00:00",
            "maxRooms": 4,
            "complianceMode": "ADVISORY",
            "priorityPreset": "balanced",
        }
    )
    assert result["recommendedCandidate"] is not None
    assert len(result["recommendedCandidate"]["roomSetJson"]) >= 2


def test_conflict_detection_blocks_some_candidates() -> None:
    result = run_allocation(
        {
            "eventName": "Overlap Case",
            "eventTypeId": _event_type_id("Conference"),
            "expectedAttendance": 80,
            "startAt": "2026-04-21T10:30:00",
            "endAt": "2026-04-21T11:30:00",
            "complianceMode": "STRICT",
            "maxRooms": 1,
        }
    )
    assert any(
        any("Time conflict" in reason for reason in candidate["reasonsJson"]["hard_fail_reasons"])
        for candidate in result["failedCandidatesSummary"]
    )


def test_manual_override_is_audited() -> None:
    result = run_allocation(
        {
            "eventName": "Override Test",
            "eventTypeId": _event_type_id("Conference"),
            "expectedAttendance": 120,
            "startAt": "2026-04-25T10:00:00",
            "endAt": "2026-04-25T12:00:00",
            "complianceMode": "ADVISORY",
        }
    )
    chosen = result["rankedCandidates"][-1]["candidateKey"]
    override = manual_override(
        run_id=result["runId"],
        chosen_candidate_key=chosen,
        overridden_by="planner@campus.edu",
        reason="Operational preference",
    )
    details = get_allocation_run(result["runId"])
    assert override["chosenCandidateKey"] == chosen
    assert details["manualOverride"]["reason"] == "Operational preference"


def test_custom_event_type_end_to_end() -> None:
    result = run_allocation(
        {
            "eventName": "Hackathon",
            "customEventType": "Hackathon",
            "eventProfileConfig": {
                "capacity_buffer": 1.05,
                "occupancy_threshold": 0.9,
                "attendance_tiers": [{"min_attendance": 1, "max_attendance": 2000, "requirements": []}],
                "legal_rules": {"min_emergency_exit_per_200": 1, "max_people_per_washroom": 140},
            },
            "expectedAttendance": 100,
            "startAt": "2026-04-26T09:00:00",
            "endAt": "2026-04-26T18:00:00",
            "complianceMode": "ADVISORY",
        }
    )
    assert result["recommendedCandidate"] is not None


def test_no_feasible_room_returns_actionable_unmet_requirements() -> None:
    result = run_allocation(
        {
            "eventName": "Impossible Event",
            "eventTypeId": _event_type_id("Concert"),
            "expectedAttendance": 2500,
            "startAt": "2026-04-27T09:00:00",
            "endAt": "2026-04-27T11:00:00",
            "maxRooms": 2,
            "complianceMode": "STRICT",
        }
    )
    assert result["recommendedCandidate"] is None
    assert len(result["unmetRequirements"]) > 0
