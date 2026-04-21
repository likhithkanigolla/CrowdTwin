#!/usr/bin/env python3
"""
campus_seed.py – IIIT Hyderabad Campus Seeder
==============================================
Creates buildings, floors, rooms and seeds the Spring 2026 lecture/lab
timetable into the CrowdTwin backend allocation engine.

It calls the backend REST API so the data lands in all in-memory stores
exactly as if a user had entered it through the UI.

Usage:
    python campus_seed.py                          # default backend
    python campus_seed.py --backend http://localhost:8904
    python campus_seed.py --reset                  # force-reset stores first
    python campus_seed.py --dry-run                # print payloads, don't POST
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, date
from typing import Any, Dict, List, Optional

DEFAULT_BACKEND = "http://localhost:8904"

# ---------------------------------------------------------------------------
# Helper: thin HTTP client (stdlib only)
# ---------------------------------------------------------------------------

def _post(url: str, payload: Dict[str, Any], dry_run: bool = False) -> Dict[str, Any]:
    if dry_run:
        print(f"DRY-RUN POST {url}")
        print(json.dumps(payload, indent=2)[:400])
        return {"id": "dry-run-id"}

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw: bytes = resp.read()
            return json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as exc:
        raw_err: bytes = exc.read()
        print(f"  HTTP {exc.code} on POST {url}: {raw_err.decode()[:300]}")
        raise


# ---------------------------------------------------------------------------
# Campus catalogue
# ---------------------------------------------------------------------------

# Each entry: (building_key, display_name, lat, lng, category, floors_spec)
# floors_spec: list of (floor_label, rooms)
# rooms: list of (room_name, capacity, room_type)

CAMPUS_BUILDINGS = [
    {
        "key": "himalaya",
        "name": "Himalaya",
        "lat": 17.44544,
        "lng": 78.34913,
        "category": "classroom",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("H101", 120, "lecture"),
                    ("H102", 100, "lecture"),
                    ("H103", 90,  "lecture"),
                    ("H104", 80,  "lecture"),
                    ("H105", 70,  "lecture"),
                ],
            },
            {
                "label": "First Floor",
                "rooms": [
                    ("H201", 100, "lecture"),
                    ("H202", 90,  "lecture"),
                    ("H203", 100, "lecture"),
                    ("H204", 80,  "lecture"),
                    ("H205", 70,  "lecture"),
                ],
            },
            {
                "label": "Second Floor",
                "rooms": [
                    ("H301", 80,  "lecture"),
                    ("H302", 70,  "lecture"),
                ],
            },
        ],
    },
    {
        "key": "himalaya_sh",
        "name": "Himalaya (SH Halls)",
        "lat": 17.44548,
        "lng": 78.34918,
        "category": "classroom",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("SH1", 250, "auditorium"),
                    ("SH2", 200, "auditorium"),
                    ("SH3", 180, "auditorium"),
                ],
            },
        ],
    },
    {
        "key": "new_academic_labs",
        "name": "New Academic Block (N-Block)",
        "lat": 17.44520,
        "lng": 78.34900,
        "category": "lab",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("N-104",  60, "lab"),
                    ("N-114",  50, "lab"),
                    ("N-125",  50, "lab"),
                ],
            },
        ],
    },
    {
        "key": "tutorial_labs",
        "name": "Tutorial Labs Block",
        "lat": 17.44535,
        "lng": 78.34905,
        "category": "lab",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("TL1", 40, "tutorial"),
                    ("TL2", 40, "tutorial"),
                    ("TL3", 40, "tutorial"),
                ],
            },
        ],
    },
    {
        "key": "b_block",
        "name": "B-Block",
        "lat": 17.44510,
        "lng": 78.34870,
        "category": "lab",
        "floors": [
            {
                "label": "Basement",
                "rooms": [
                    ("B4-304", 60, "tutorial"),
                    ("B4-302", 50, "tutorial"),
                    ("B6-309", 60, "lab"),
                ],
            },
        ],
    },
    {
        "key": "cr_block",
        "name": "CR Block",
        "lat": 17.44510,
        "lng": 78.34880,
        "category": "classroom",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("CR1", 80, "lecture"),
                ],
            },
        ],
    },
    {
        "key": "a3_block",
        "name": "A3 Block (Science Labs)",
        "lat": 17.44505,
        "lng": 78.34860,
        "category": "lab",
        "floors": [
            {
                "label": "Third Floor",
                "rooms": [
                    ("A3-301", 45, "lab"),
                ],
            },
        ],
    },
    {
        "key": "t_hub",
        "name": "T-Hub",
        "lat": 17.44568,
        "lng": 78.34882,
        "category": "research",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("TH-Open-Lab", 80,  "lab"),
                    ("TH-Meeting",  30,  "conference"),
                ],
            },
            {
                "label": "First Floor",
                "rooms": [
                    ("TH-Research-1", 40, "lab"),
                    ("TH-Research-2", 40, "lab"),
                ],
            },
        ],
    },
    {
        "key": "academic_office",
        "name": "Academic Office",
        "lat": 17.44495,
        "lng": 78.34989,
        "category": "research",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("AO-Lab-1",  50, "lab"),
                    ("AO-Lab-2",  50, "lab"),
                    ("AO-Office", 30, "office"),
                ],
            },
        ],
    },
    {
        "key": "new_boys_hostel",
        "name": "New Boys Hostel (NBH)",
        "lat": 17.44716,
        "lng": 78.34760,
        "category": "hostel",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"NBH-{i}{j:02d}", 2, "bedroom") for j in range(1, 21)]}
            for i in range(1, 5)
        ],
    },
    {
        "key": "obh_ff",
        "name": "OBH-FF",
        "lat": 17.44476,
        "lng": 78.34572,
        "category": "hostel",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"OBH-F{i}-{j:02d}", 2, "bedroom") for j in range(1, 16)]}
            for i in range(1, 4)
        ],
    },
    {
        "key": "bakul_nivas",
        "name": "Bakul Nivas",
        "lat": 17.44819,
        "lng": 78.34850,
        "category": "hostel",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"BN-{i}{j:02d}", 2, "bedroom") for j in range(1, 16)]}
            for i in range(1, 4)
        ],
    },
    {
        "key": "girls_hostel",
        "name": "Girls Hostel",
        "lat": 17.44757,
        "lng": 78.34741,
        "category": "girls_hostel",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"GH-{i}{j:02d}", 2, "bedroom") for j in range(1, 21)]}
            for i in range(1, 5)
        ],
    },
    {
        "key": "block_e_fsq",
        "name": "Block E, Faculty and Staff Quarters",
        "lat": 17.44434,
        "lng": 78.34796,
        "category": "residential",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"BE-{i}{j:02d}", 3, "apartment") for j in range(1, 9)]}
            for i in range(1, 4)
        ],
    },
    {
        "key": "juice_canteen",
        "name": "Juice Canteen",
        "lat": 17.44793,
        "lng": 78.34758,
        "category": "canteen",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [("JC-Dining", 150, "canteen")],
            },
        ],
    },
    {
        "key": "basketball_canteen",
        "name": "Basketball Canteen",
        "lat": 17.44785,
        "lng": 78.34753,
        "category": "canteen",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [("BC-Dining", 120, "canteen")],
            },
        ],
    },
    {
        "key": "amphitheater",
        "name": "Amphitheater",
        "lat": 17.44797,
        "lng": 78.34791,
        "category": "venue",
        "floors": [
            {
                "label": "Open Air",
                "rooms": [("Amph-Main", 1000, "arena")],
            },
        ],
    },
]

# ---------------------------------------------------------------------------
# Spring 2026 Timetable  (extracted from PDFs)
# ---------------------------------------------------------------------------
import os
import json

SLOT_TIMES = {
    1: ("08:30", "09:55"),
    2: ("10:05", "11:30"),
    3: ("11:40", "13:05"),
    4: ("14:00", "15:25"),
    5: ("15:35", "17:00"),
    6: ("17:10", "18:40"),
}

LAB_SLOT_TIME = ("14:00", "17:00")
TIMETABLE: List[Dict[str, Any]] = []

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "campus_data_real.json")
try:
    with open(DATA_PATH, "r") as f:
        real_data = json.load(f)
        
    for room in real_data.get("rooms", []):
        if room == "Unknown": continue
        
        target_key = "himalaya"
        if room.startswith("SH"): target_key = "himalaya_sh"
        elif room.startswith("N-"): target_key = "new_academic_labs"
        elif room.startswith("TL"): target_key = "tutorial_labs"
        elif room.startswith("B4") or room.startswith("B6"): target_key = "b_block"
        elif room.startswith("CR"): target_key = "cr_block"
        elif room.startswith("A3"): target_key = "a3_block"
            
        for b in CAMPUS_BUILDINGS:
            if b["key"] == target_key:
                if not any(r[0] == room for f in b["floors"] for r in f["rooms"]):
                    b["floors"][0]["rooms"].append((room, 90, "lecture" if target_key == "himalaya" else "lab"))
                break

    for b in real_data.get("bookings", []):
        slot_str = str(b.get("slot", "1"))
        slot_n = 1
        for s in range(1, 7):
            if str(s) in slot_str:
                slot_n = s
                break
        
        course = b.get("raw_text", "")
        cohort = "MS"
        if "UG1" in course: cohort = "UG1"
        elif "UG2" in course: cohort = "UG2"
        elif "UG3" in course: cohort = "UG3"
        elif "UG4" in course: cohort = "UG4"
        elif "PhD" in course: cohort = "PhD"
        
        day_str = b.get("day", "Mon")
        if "Mon" in day_str: day_str = "Mon"
        elif "Tue" in day_str: day_str = "Tue"
        elif "Wed" in day_str: day_str = "Wed"
        elif "Thu" in day_str: day_str = "Thu"
        elif "Fri" in day_str: day_str = "Fri"
        elif "Sat" in day_str: day_str = "Sat"
        else: day_str = "Mon"
        
        TIMETABLE.append({
            "course": course,
            "day": day_str,
            "slot": slot_n,
            "room": b.get("room", "Unknown"),
            "cohort": cohort,
            "half": None
        })
except Exception as e:
    print(f"Warning: Could not load real data: {e}")

# Cohort average attendance (used as expectedAttendance in bookings)
COHORT_ATTENDANCE = {
    "UG1":     550,
    "UG1_CSE": 200,
    "UG1_CLD": 80,
    "UG1_CND": 120,
    "UG1_ECE": 180,
    "UG1_CHD": 80,
    "UG2":     500,
    "UG2_CSE": 160,
    "UG2_ECE": 170,
    "UG3":     480,
    "UG3_CSE": 150,
    "UG3_ECE": 140,
    "UG4":     400,
    "UG4_ECE": 120,
    "MS":      200,
    "PhD":     120,
}

# ---------------------------------------------------------------------------
# Main seeder
# ---------------------------------------------------------------------------

class CampusSeeder:
    def __init__(self, backend: str, dry_run: bool):
        self.backend = backend.rstrip("/")
        self.dry_run = dry_run

        # Filled during seeding
        self.site_id: str = ""
        self.building_ids: Dict[str, str] = {}       # key → id
        self.room_name_to_id: Dict[str, str] = {}    # room_name → room_id
        self.lecture_event_type_id: str = ""
        self.lab_event_type_id: str = ""

    # ── helpers ─────────────────────────────────────────────────────────────

    def _url(self, path: str) -> str:
        return f"{self.backend}{path}"

    def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return _post(self._url(path), payload, self.dry_run)

    # ── step 1 : site ───────────────────────────────────────────────────────

    def seed_site(self) -> None:
        print("  Creating IIIT-H site …")
        resp = self.post("/sites", {
            "name": "IIIT Hyderabad Campus",
            "geoBoundary": {
                "type": "Polygon",
                "coordinates": [
                    [78.3455, 17.4430],
                    [78.3520, 17.4430],
                    [78.3520, 17.4485],
                    [78.3455, 17.4485],
                    [78.3455, 17.4430],
                ],
            },
        })
        self.site_id = resp.get("id", "dry-run-site")
        print(f"    ✓ Site id = {self.site_id}")

    # ── step 2 : buildings + floors + rooms ─────────────────────────────────

    def seed_buildings(self) -> None:
        print("  Creating buildings, floors and rooms …")
        for bspec in CAMPUS_BUILDINGS:
            print(f"    Building: {bspec['name']}")
            # Create building
            b_resp = self.post("/buildings", {
                "siteId": self.site_id,
                "name": bspec["name"],
                "location": {"lat": bspec["lat"], "lng": bspec["lng"]},
                "category": bspec["category"],
            })
            bid = b_resp.get("id", "dry-id")
            self.building_ids[bspec["key"]] = bid

            # Create rooms in each floor
            for floor_spec in bspec["floors"]:
                floor_label = floor_spec["label"]
                for (room_name, capacity, room_type) in floor_spec["rooms"]:
                    r_resp = self.post("/rooms", {
                        "buildingId": bid,
                        "name": room_name,
                        "floor": floor_label,
                        "capacity": capacity,
                        "roomType": room_type,
                        "status": "available",
                        "accessibilityScore": 0.75,
                        "estimatedCost": 0.0,
                    })
                    self.room_name_to_id[room_name] = r_resp.get("id", "dry-room-id")

        print(f"    ✓ {len(self.building_ids)} buildings, {len(self.room_name_to_id)} rooms")

    # ── step 3 : event types ────────────────────────────────────────────────

    def seed_event_types(self) -> None:
        print("  Creating event types …")
        lec = self.post("/event-types", {"name": "Lecture", "isCustom": False})
        lab = self.post("/event-types", {"name": "Lab / Tutorial", "isCustom": False})
        self.lecture_event_type_id = lec.get("id", "dry-lec-id")
        self.lab_event_type_id = lab.get("id", "dry-lab-id")

        # Create minimal profiles for both
        for etype_id, _label in [
            (self.lecture_event_type_id, "Lecture"),
            (self.lab_event_type_id, "Lab / Tutorial"),
        ]:
            self.post("/event-profiles", {
                "eventTypeId": etype_id,
                "configJson": {
                    "capacity_buffer": 1.0,
                    "occupancy_threshold": 0.95,
                    "attendance_tiers": [
                        {
                            "min_attendance": 1,
                            "max_attendance": 10000,
                            "requirements": [],
                        }
                    ],
                    "legal_rules": {
                        "min_emergency_exit_per_200": 1,
                        "max_people_per_washroom": 200,
                    },
                },
            })
        print("    ✓ Lecture & Lab/Tutorial event types created")

    # ── step 4 : timetable bookings ─────────────────────────────────────────

    def seed_timetable(self) -> None:
        print("  Seeding Spring 2026 timetable bookings …")
        today = date.today()
        # Find the Monday of the current week as anchor
        days_since_mon = today.weekday()
        week_start = today  # Use today's actual date for the demo week

        day_offsets = {
            "Mon": 0, "Tue": 1, "Wed": 2,
            "Thu": 3, "Fri": 4, "Sat": 5,
        }

        created, skipped = 0, 0
        for entry in TIMETABLE:
            day_offset = day_offsets.get(entry["day"], 0)
            slot_n = entry["slot"]
            times = SLOT_TIMES.get(slot_n, ("08:00", "09:30"))
            event_date = week_start  # anchor to today for demo; in prod you'd loop weeks

            start_iso = f"{event_date}T{times[0]}:00"
            end_iso   = f"{event_date}T{times[1]}:00"

            room_name = entry["room"]
            room_id = self.room_name_to_id.get(room_name)
            if not room_id:
                skipped += 1
                continue

            cohort = entry["cohort"]
            attendance = COHORT_ATTENDANCE.get(cohort, 60)
            is_lab = "LAB" in entry["course"].upper() or "Lab" in room_name or "Tutorial" in entry["course"]
            etype_id = self.lab_event_type_id if is_lab else self.lecture_event_type_id

            course_label = entry["course"]
            if entry.get("half"):
                course_label += f" ({entry['half']})"

            try:
                self.post("/bookings", {
                    "eventName": f"{course_label} – {room_name} [{entry['day']} S{slot_n}]",
                    "eventTypeId": etype_id,
                    "expectedAttendance": attendance,
                    "startAt": start_iso,
                    "endAt": end_iso,
                    "siteScope": [self.site_id],
                    "buildingScope": [],
                    "status": "confirmed",
                })
                created += 1
            except Exception as exc:
                skipped += 1
                if self.dry_run:
                    print(f"      skipping {course_label}: {exc}")

        print(f"    ✓ {created} bookings created, {skipped} skipped (room not found or error)")

    # ── step 5 : sync static frontend config ──────────────────────────────────
    
    def sync_frontend_seed(self) -> None:
        print("  Syncing configuration to frontend static seed …")
        out = {
          "schemaVersion": 1,
          "configs": [{
              "id": "cfg-IIITH-main",
              "campusName": "IIITH — Main Campus",
              "center": { "lat": 17.4464, "lng": 78.3487 },
              "radiusMeters": 450,
              "buildings": [],
              "gates": [],
              "displays": [{"id": "disp-1", "name": "Display — Main Junction", "lat": 17.44698, "lng": 78.34812, "routeMode": "normal", "activeMessage": "All routes operational"}],
              "timetables": [],
              "rules": [],
              "createdAt": "2026-04-22T00:00:00.000Z",
              "updatedAt": "2026-04-22T00:00:00.000Z"
          }]
        }
        for b in CAMPUS_BUILDINGS:
            b_out = {
                "id": b["key"],
                "name": b["name"],
                "category": b["category"],
                "position": {"lat": b["lat"], "lng": b["lng"]},
                "floors": []
            }
            for f_idx, f in enumerate(b["floors"]):
                f_out = {"floorNumber": f_idx, "rooms": []}
                for r in f.get("rooms", []):
                    f_out["rooms"].append({
                        "id": r[0].replace(" ", "_").replace(".", "_") + f"_{f_idx}",
                        "name": r[0],
                        "capacity": r[1],
                        "roomType": r[2],
                        "equipment": {"pc": True, "projector": True}
                    })
                b_out["floors"].append(f_out)
            out["configs"][0]["buildings"].append(b_out)
            
        frontend_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "data", "campusConfig.seed.json")
        try:
            with open(frontend_path, "w") as f:
                json.dump(out, f, indent=2)
            print(f"    ✓ Synced {len(CAMPUS_BUILDINGS)} buildings to {frontend_path}")
        except Exception as e:
            print(f"    ✗ Failed to sync frontend: {e}")

    # ── run ─────────────────────────────────────────────────────────────────

    def run(self, reset: bool = False) -> None:
        if reset and not self.dry_run:
            print("  Resetting existing allocation stores …")
            try:
                _post(self._url("/allocations/seed"), {"force": True}, dry_run=False)
            except Exception:
                pass  # endpoint might not exist; that's fine

        print()
        self.seed_site()
        self.seed_buildings()
        self.seed_event_types()
        self.seed_timetable()
        self.sync_frontend_seed()
        print()
        print("✅  Campus seed complete.")
        print(f"   Site    : IIIT Hyderabad Campus ({self.site_id})")
        print(f"   Buildings: {len(self.building_ids)}")
        print(f"   Rooms    : {len(self.room_name_to_id)}")
        print(f"   Timetable: {len(TIMETABLE)} entries processed")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Seed IIIT-H campus buildings and timetable into CrowdTwin backend")
    p.add_argument("--backend",  default=DEFAULT_BACKEND, help="Backend base URL")
    p.add_argument("--reset",    action="store_true",     help="Force-reset existing allocation stores first")
    p.add_argument("--dry-run",  action="store_true",     help="Print payloads without POSTing")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    print("🏫 IIIT-H Campus Seeder")
    print(f"   Backend : {args.backend}")
    print(f"   Dry-run : {args.dry_run}")
    print(f"   Reset   : {args.reset}")

    seeder = CampusSeeder(backend=args.backend, dry_run=args.dry_run)
    try:
        seeder.run(reset=args.reset)
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        sys.exit(1)
    except urllib.error.URLError as exc:
        print(f"\n❌  Cannot reach backend at {args.backend}: {exc}")
        print("    Start the backend first:  cd backend && uvicorn main:app --port 8904")
        sys.exit(1)


if __name__ == "__main__":
    main()
