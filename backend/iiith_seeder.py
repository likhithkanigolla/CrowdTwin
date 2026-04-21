#!/usr/bin/env python3
"""
iiith_seeder.py – IIIT-H Realistic Campus Camera Seeder
========================================================
Sends per-second synthetic camera data to the CrowdTwin backend.

Features:
  • 24 hardcoded cameras: one per named building + 4 road cameras
  • Timetable-aware occupancy (Spring 2026 lecture/lab slot times)
  • Day-of-week awareness (weekends → no classes, more hostel occupancy)
  • Cohort-based population split (~4000 total)
  • Smooth count transitions (counts drift toward targets, never jump)
  • Lunch / dinner canteen spikes at realistic times

Usage:
  python iiith_seeder.py
  python iiith_seeder.py --backend http://localhost:8904 --interval 1 --campus-total 4000
  python iiith_seeder.py --dry-run          # print counts, don't POST
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Tuple

DEFAULT_BACKEND  = "http://localhost:8904"
CAMPUS_TOTAL_DEFAULT = 4000

# ---------------------------------------------------------------------------
# Timetable slot definitions (inclusive, 24-h)
# ---------------------------------------------------------------------------
# (start_hour_float, end_hour_float)
SLOTS: List[Tuple[float, float]] = [
    (8.50,  9.917),   # Slot 1 : 08:30 – 09:55
    (10.083, 11.50),  # Slot 2 : 10:05 – 11:30
    (11.667, 13.083), # Slot 3 : 11:40 – 13:05
    (14.00, 15.417),  # Slot 4 : 14:00 – 15:25
    (15.583, 17.00),  # Slot 5 : 15:35 – 17:00
    (17.167, 18.667), # Slot 6 : 17:10 – 18:40
]

LUNCH_WINDOW  = (13.083, 14.00)  # 13:05 – 14:00
DINNER_WINDOW = (19.00,  20.00)  # 19:00 – 20:00
BREAKFAST_WINDOW = (7.50, 8.50)  # 07:30 – 08:30

def _now_float() -> float:
    """Current time as fractional hours (0–24)."""
    t = datetime.now()
    return t.hour + t.minute / 60.0 + t.second / 3600.0

def _in_class(h: float, is_weekend: bool) -> bool:
    if is_weekend:
        return False
    return any(s <= h <= e for s, e in SLOTS)

def _in_slot_6(h: float, is_weekend: bool) -> bool:
    if is_weekend:
        return False
    s, e = SLOTS[5]
    return s <= h <= e

def _in_lunch(h: float) -> bool:
    return LUNCH_WINDOW[0] <= h <= LUNCH_WINDOW[1]

def _in_dinner(h: float) -> bool:
    return DINNER_WINDOW[0] <= h <= DINNER_WINDOW[1]

def _in_breakfast(h: float) -> bool:
    return BREAKFAST_WINDOW[0] <= h <= BREAKFAST_WINDOW[1]

# ---------------------------------------------------------------------------
# Camera catalogue
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Camera:
    camera_id: str
    location_name: str
    zone: str            # used for zone multiplier key
    lat: float
    lng: float
    # Rough fraction of active campus population this camera should see
    base_share: float
    # Which cohorts primarily appear here
    cohorts: Tuple[str, ...]


# campus_total × this share × zone_multiplier(h) = expected count at camera
CAMERAS: List[Camera] = [
    # ── Hostels ─────────────────────────────────────────────────────────────
    Camera("cam_obh_ff",       "OBH-FF",              "hostel",       17.44476, 78.34572, 0.080, ("UG1","UG4")),
    Camera("cam_bakul_nivas",  "Bakul Nivas",          "hostel",       17.44819, 78.34850, 0.070, ("UG3","UG4")),
    Camera("cam_nbh",          "New Boys Hostel (NBH)","hostel",       17.44716, 78.34760, 0.065, ("MS","PhD")),
    Camera("cam_girls_main",   "Girls Hostel",         "girls_hostel", 17.44757, 78.34741, 0.050, ("Girls",)),
    Camera("cam_girls_b1",     "Girls Hostel Block-1", "girls_hostel", 17.44699, 78.34685, 0.030, ("Girls",)),
    Camera("cam_girls_b2",     "Girls Hostel Block-2", "girls_hostel", 17.44730, 78.34715, 0.030, ("Girls",)),
    # ── Academic ─────────────────────────────────────────────────────────────
    Camera("cam_himalaya",     "Himalaya",             "classroom",    17.44544, 78.34913, 0.140, ("UG1","UG2","UG3","UG4")),
    Camera("cam_himalaya_sh",  "Himalaya SH Halls",    "classroom",    17.44548, 78.34918, 0.060, ("UG1","UG2","UG3")),
    # ── Research / Labs ──────────────────────────────────────────────────────
    Camera("cam_t_hub",        "T-Hub",                "research",     17.44568, 78.34882, 0.060, ("UG4","MS","PhD")),
    Camera("cam_academic_off", "Academic Office",      "research",     17.44495, 78.34989, 0.040, ("MS","PhD","Faculty")),
    Camera("cam_n_block",      "N-Block Labs",         "lab",          17.44520, 78.34900, 0.030, ("UG1","UG2")),
    Camera("cam_b_block",      "B-Block",              "lab",          17.44510, 78.34870, 0.025, ("UG1","UG2","MS")),
    Camera("cam_a3",           "A3 Science Labs",      "lab",          17.44505, 78.34860, 0.015, ("UG1",)),
    # ── Canteens ─────────────────────────────────────────────────────────────
    Camera("cam_juice_canteen","Juice Canteen",        "canteen",      17.44793, 78.34758, 0.045, ("all",)),
    Camera("cam_bball_canteen","Basketball Canteen",   "canteen",      17.44785, 78.34753, 0.035, ("all",)),
    # ── Residential (Faculty/Staff/Interns) ──────────────────────────────────
    Camera("cam_block_e",      "Block E FSQ",          "residential",  17.44434, 78.34796, 0.020, ("Interns","PhD")),
    Camera("cam_block_d",      "Block D FSQ",          "residential",  17.44385, 78.34777, 0.015, ("Faculty",)),
    Camera("cam_block_c",      "Block C FSQ",          "residential",  17.44334, 78.34783, 0.015, ("Faculty",)),
    Camera("cam_ananda_nivas", "Ananda Nivas",         "residential",  17.44397, 78.34848, 0.015, ("Faculty",)),
    Camera("cam_buddha_nivas", "Buddha Nivas",         "residential",  17.44331, 78.34852, 0.015, ("Faculty",)),
    # ── Venue ────────────────────────────────────────────────────────────────
    Camera("cam_amphitheater", "Amphitheater",         "venue",        17.44797, 78.34791, 0.020, ("all",)),
    # ── Gate ─────────────────────────────────────────────────────────────────
    Camera("cam_main_gate",    "SBI ATM / Main Gate",  "gate",         17.44584, 78.35158, 0.025, ("all",)),
    # ── Roads ────────────────────────────────────────────────────────────────
    Camera("cam_road_central", "Road: Central Axis",   "road",         17.44556, 78.34898, 0.020, ("all",)),
    Camera("cam_road_hostel",  "Road: Hostel Axis",    "road",         17.44735, 78.34772, 0.015, ("all",)),
]

# ---------------------------------------------------------------------------
# Zone multipliers: (hour_float, is_weekend) -> multiplier
# ---------------------------------------------------------------------------

def _zone_multiplier(zone: str, h: float, is_weekend: bool) -> float:
    in_class = _in_class(h, is_weekend)
    in_slot6 = _in_slot_6(h, is_weekend)
    lunch = _in_lunch(h)
    dinner = _in_dinner(h)
    breakfast = _in_breakfast(h)
    night = h < 6.0 or h >= 23.0
    late_night = h < 5.0 or h >= 23.5

    if zone == "hostel":
        if night:        return 1.0
        if in_class:     return 0.15   # most people in class
        if lunch:        return 0.55   # some back for lunch
        if dinner:       return 0.80   # return after dinner
        if h >= 22.0:    return 0.95
        return 0.30

    if zone == "girls_hostel":
        return _zone_multiplier("hostel", h, is_weekend)

    if zone == "classroom":
        if is_weekend:   return 0.05
        if in_class:     return 1.00
        if in_slot6:     return 0.70
        if lunch:        return 0.20
        if 7.5 < h < 8.5:  return 0.30  # pre-class build-up
        return 0.05

    if zone == "research":
        if 9.0 <= h <= 20.0:
            return 0.75 if not is_weekend else 0.35
        if 7.0 <= h < 9.0:  return 0.40
        return 0.10

    if zone == "lab":
        if is_weekend:   return 0.10
        if in_class:     return 0.60
        if lunch:        return 0.15
        return 0.20

    if zone == "canteen":
        if breakfast:    return 1.20
        if lunch:        return 1.50
        if dinner:       return 1.40
        if 10.0 <= h <= 11.0: return 0.60  # tea/snack break
        if 15.5 <= h <= 16.5: return 0.60
        return 0.15

    if zone == "residential":
        # Faculty mostly home nights / weekends, office during day
        if 9.0 <= h <= 17.0 and not is_weekend:  return 0.30
        return 0.80

    if zone == "venue":
        if 17.0 <= h <= 22.0:  return 0.60
        if 12.0 <= h <= 14.0:  return 0.30
        return 0.05

    if zone == "gate":
        if is_weekend:
            if 9.0 <= h <= 18.0: return 0.50
            return 0.20
        if 7.5 <= h <= 9.0:   return 1.00   # morning rush
        if 17.0 <= h <= 19.0: return 0.90   # evening exit
        if 12.0 <= h <= 14.0: return 0.50   # lunch deliveries
        return 0.30

    if zone == "road":
        # Mirrors gate activity but lower density
        if is_weekend:   return 0.25
        if in_class:     return 0.40
        if lunch:        return 0.80
        if 7.5 <= h <= 9.0:  return 0.70
        if 17.0 <= h <= 19.0: return 0.65
        return 0.25

    return 0.50   # fallback


# ---------------------------------------------------------------------------
# Generator state
# ---------------------------------------------------------------------------

class SeederState:
    def __init__(self, campus_total: int):
        self.campus_total = max(400, campus_total)
        self.current: Dict[str, float] = {c.camera_id: 0.0 for c in CAMERAS}
        self.target:  Dict[str, float] = {c.camera_id: 0.0 for c in CAMERAS}
        self._last_refresh = 0.0

    # ── refresh targets (every 15 ticks) ────────────────────────────────────

    def refresh_targets(self) -> None:
        now_h = _now_float()
        weekday = datetime.now().weekday()  # 0=Mon … 6=Sun
        is_weekend = weekday >= 5

        # Total people visible to cameras (not sleeping off-campus)
        # Night: ~80% in hostels; day: up to 70% actively spread across campus
        if now_h < 6.0 or now_h >= 23.0:
            active_ratio = 0.90
        elif now_h < 7.5 or now_h >= 21.0:
            active_ratio = 0.70
        else:
            active_ratio = 0.72
        active_pop = int(self.campus_total * active_ratio)

        # Compute weighted shares per camera
        raw: Dict[str, float] = {}
        for cam in CAMERAS:
            mult = _zone_multiplier(cam.zone, now_h, is_weekend)
            wave = 1.0 + 0.06 * math.sin(
                (now_h / 24.0) * 2.0 * math.pi + (hash(cam.camera_id) % 7)
            )
            jitter = random.uniform(0.92, 1.08)
            raw[cam.camera_id] = max(0.005, cam.base_share * mult * wave * jitter)

        total_raw = sum(raw.values()) or 1.0
        for cam_id, score in raw.items():
            self.target[cam_id] = (score / total_raw) * active_pop

    # ── smooth step toward target ────────────────────────────────────────────

    def step(self) -> None:
        for cam_id, cur in self.current.items():
            tgt = self.target.get(cam_id, cur)
            delta = tgt - cur
            if abs(delta) < 0.5:
                self.current[cam_id] = tgt
                continue
            step = max(1.0, min(15.0, abs(delta) * 0.25))
            self.current[cam_id] = cur + (step if delta > 0 else -step)

    # ── build API payload ────────────────────────────────────────────────────

    def make_payload(self, node_id: str) -> Dict:
        now_iso = datetime.now(timezone.utc).isoformat()
        readings = []
        for cam in CAMERAS:
            count = max(0, int(round(self.current[cam.camera_id])))
            direction = "bidirectional"
            if cam.zone in {"gate", "road"}:
                direction = random.choice(["in", "out", "bidirectional"])
            readings.append({
                "camera_id":     cam.camera_id,
                "location_name": cam.location_name,
                "zone":          cam.zone,
                "lat":           cam.lat,
                "lng":           cam.lng,
                "people_count":  count,
                "direction":     direction,
            })
        return {
            "node_id":      node_id,
            "generated_at": now_iso,
            "readings":     readings,
        }

    def total_visible(self) -> int:
        return int(sum(self.current.values()))


# ---------------------------------------------------------------------------
# HTTP helper (stdlib)
# ---------------------------------------------------------------------------

def _post_json(url: str, payload: Dict, timeout: float = 8.0) -> Dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode()
        return json.loads(body) if body else {}


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

async def run(backend: str, interval: float, campus_total: int, dry_run: bool) -> None:
    endpoint = f"{backend.rstrip('/')}/synthetic/nodes/ingest"
    state = SeederState(campus_total)
    state.refresh_targets()

    print(f"🏫  IIIT-H Seeder  →  {endpoint if not dry_run else 'DRY-RUN'}")
    print(f"    Cameras      : {len(CAMERAS)}")
    print(f"    Campus total : {campus_total}")
    print(f"    Interval     : {interval:.1f}s")
    print("    Press Ctrl+C to stop\n")

    tick = 0
    while True:
        tick += 1
        if tick % 15 == 1:
            state.refresh_targets()
        state.step()

        payload = state.make_payload("iiith-seeder-v2")
        h = _now_float()
        weekday = datetime.now().weekday()
        is_weekend = weekday >= 5
        in_c = _in_class(h, is_weekend)
        activity = (
            "class"     if in_c                    else
            "lunch"     if _in_lunch(h)            else
            "dinner"    if _in_dinner(h)           else
            "breakfast" if _in_breakfast(h)        else
            "evening"   if 17 <= h <= 22           else
            "night"     if (h >= 23 or h < 6)      else
            "free"
        )

        if dry_run:
            print(f"[DRY-RUN] tick={tick:04d}  total={state.total_visible():4d}  "
                  f"activity={activity}  {'weekend' if is_weekend else 'weekday'}")
            # Print a brief table every 10 ticks
            if tick % 10 == 1:
                print(f"  {'Camera':35s}  {'cur':>5}  {'tgt':>5}")
                for cam in CAMERAS:
                    print(f"  {cam.location_name:35s}  "
                          f"{int(state.current[cam.camera_id]):5d}  "
                          f"{int(state.target[cam.camera_id]):5d}")
                print()
        else:
            try:
                result = await asyncio.to_thread(_post_json, endpoint, payload)
                inserted = result.get("inserted_rows", "?")
                print(
                    f"[{datetime.now().strftime('%H:%M:%S')}] "
                    f"tick={tick:04d}  total={state.total_visible():4d}  "
                    f"activity={activity:9s}  "
                    f"{'WE' if is_weekend else 'WD'}  "
                    f"posted={inserted}"
                )
            except urllib.error.URLError as exc:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] backend unavailable: {exc}")
            except Exception as exc:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] error: {exc}")

        await asyncio.sleep(max(0.1, interval))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="IIIT-H realistic campus camera seeder")
    p.add_argument("--backend",       default=DEFAULT_BACKEND,     help="Backend base URL")
    p.add_argument("--interval",      type=float, default=1.0,     help="Seconds between updates (default 1)")
    p.add_argument("--campus-total",  type=int,   default=CAMPUS_TOTAL_DEFAULT, help="Total campus population (default 4000)")
    p.add_argument("--dry-run",       action="store_true",          help="Print output without POSTing")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(run(
            backend=args.backend,
            interval=args.interval,
            campus_total=args.campus_total,
            dry_run=args.dry_run,
        ))
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
