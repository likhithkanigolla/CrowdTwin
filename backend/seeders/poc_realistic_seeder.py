#!/usr/bin/env python3
"""
PoC Realistic Seeder for IIIT-H Campus

What this script does:
- Keeps a fixed catalog of priority buildings near 17.4464, 78.3487.
- Uses hardcoded cameras across buildings and road choke points.
- Generates realistic synthetic people counts every second.
- Moves counts smoothly toward new targets, so crowd movement appears gradual.
- Posts readings to backend endpoint: POST /synthetic/nodes/ingest

Usage examples:
  python poc_realistic_seeder.py --buildings-only
  python poc_realistic_seeder.py --export-buildings backend/poc_buildings_catalog.json
  python poc_realistic_seeder.py --backend http://localhost:8904 --interval 1 --campus-total 4000
  python poc_realistic_seeder.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List


DEFAULT_BACKEND = "http://localhost:8904"
DEFAULT_CENTER_LAT = 17.4464
DEFAULT_CENTER_LNG = 78.3487


@dataclass(frozen=True)
class Building:
    name: str
    lat: float
    lng: float
    category_hint: str
    note: str


@dataclass(frozen=True)
class Camera:
    camera_id: str
    location_name: str
    zone: str
    lat: float
    lng: float
    base_weight: float


BUILDINGS: List[Building] = [
    Building("OBH-FF", 17.44476, 78.34572, "hostel", "UG1 and UG4 residents"),
    Building("Block E, Faculty and Staff Quarters", 17.44434, 78.34796, "residential", "Interns and some PhD"),
    Building("Block D, Faculty and Staff Quarters", 17.44385, 78.34777, "residential", "Faculty and families"),
    Building("Ananda Nivas", 17.44397, 78.34848, "residential", "Faculty and families"),
    Building("Block C, Faculty and Staff QUarters", 17.44334, 78.34783, "residential", "Faculty and families"),
    Building("Buddha Nivas", 17.44331, 78.34852, "residential", "Faculty and families"),
    Building("Academic Office", 17.44495, 78.34989, "research", "Research labs"),
    Building("Himalaya", 17.44544, 78.34913, "academics", "Classroom block"),
    Building("T-Hub", 17.44568, 78.34882, "research", "Research labs"),
    Building("Building #639403216", 17.44699, 78.34685, "girls_hostel", "Girls hostel cluster"),
    Building("Building #639403215", 17.44730, 78.34715, "girls_hostel", "Girls hostel cluster"),
    Building("Girls Hostel", 17.44757, 78.34741, "girls_hostel", "Girls hostel main"),
    Building("Amphitheater", 17.44797, 78.34791, "venue", "Event area"),
    Building("Juice Canteen", 17.44793, 78.34758, "canteen", "Food point"),
    Building("Basketball Canteen", 17.44785, 78.34753, "canteen", "Food point"),
    Building("Bakul Nivas", 17.44819, 78.34850, "hostel", "Mostly UG3 and UG4"),
    Building("SBI ATM - IIIT Hyderabad Main Gate", 17.44584, 78.35158, "gate", "Primary entry/exit"),
    Building("New Boys Hostel", 17.44716, 78.34760, "hostel", "Mostly MS and PhD"),
]


CAMERAS: List[Camera] = [
    Camera("cam_obh_ff", "OBH-FF Entrance", "hostel", 17.44476, 78.34572, 1.10),
    Camera("cam_block_e", "Block E Quarters", "residential", 17.44434, 78.34796, 0.90),
    Camera("cam_block_d", "Block D Quarters", "residential", 17.44385, 78.34777, 0.85),
    Camera("cam_ananda_nivas", "Ananda Nivas", "residential", 17.44397, 78.34848, 0.90),
    Camera("cam_block_c", "Block C Quarters", "residential", 17.44334, 78.34783, 0.85),
    Camera("cam_buddha_nivas", "Buddha Nivas", "residential", 17.44331, 78.34852, 0.85),
    Camera("cam_academic_office", "Academic Office", "research", 17.44495, 78.34989, 1.00),
    Camera("cam_himalaya", "Himalaya", "academics", 17.44544, 78.34913, 1.35),
    Camera("cam_t_hub", "T-Hub", "research", 17.44568, 78.34882, 1.05),
    Camera("cam_639403216", "Building #639403216", "girls_hostel", 17.44699, 78.34685, 1.10),
    Camera("cam_639403215", "Building #639403215", "girls_hostel", 17.44730, 78.34715, 1.10),
    Camera("cam_girls_hostel", "Girls Hostel", "girls_hostel", 17.44757, 78.34741, 1.20),
    Camera("cam_amphitheater", "Amphitheater", "venue", 17.44797, 78.34791, 0.95),
    Camera("cam_juice_canteen", "Juice Canteen", "canteen", 17.44793, 78.34758, 1.15),
    Camera("cam_basketball_canteen", "Basketball Canteen", "canteen", 17.44785, 78.34753, 1.15),
    Camera("cam_bakul_nivas", "Bakul Nivas", "hostel", 17.44819, 78.34850, 1.20),
    Camera("cam_main_gate", "Main Gate", "gate", 17.44584, 78.35158, 1.10),
    Camera("cam_new_boys_hostel", "New Boys Hostel", "hostel", 17.44716, 78.34760, 1.10),
    Camera("cam_road_himalaya_t_hub", "Road: Himalaya <-> T-Hub", "road", 17.44556, 78.34898, 1.00),
    Camera("cam_road_hostel_axis", "Road: Hostel Axis", "road", 17.44735, 78.34772, 1.00),
    Camera("cam_road_residential_axis", "Road: Residential Axis", "road", 17.44370, 78.34805, 0.90),
    Camera("cam_road_gate_corridor", "Road: Main Gate Corridor", "road", 17.44588, 78.35085, 0.95),
]


def _hour_float() -> float:
    now = datetime.now()
    return now.hour + now.minute / 60.0 + now.second / 3600.0


def _zone_multiplier(zone: str, h: float, weekday: int) -> float:
    is_weekend = weekday >= 5
    in_class = (8.5 <= h <= 13.1) or (14.0 <= h <= 17.0)
    lunch = 13.1 <= h <= 14.1
    dinner = 19.0 <= h <= 20.0
    breakfast = 7.4 <= h <= 8.5
    rush = (7.8 <= h <= 9.2) or (17.0 <= h <= 19.0)

    if zone in {"hostel", "girls_hostel"}:
        if h < 6.0 or h >= 23.0:
            return 1.0
        if is_weekend:
            return 0.85
        if in_class:
            return 0.25
        if dinner:
            return 0.85
        if breakfast or lunch:
            return 0.55
        return 0.45

    if zone == "academics":
        if is_weekend:
            return 0.08
        if in_class:
            return 1.25
        if lunch:
            return 0.25
        return 0.15

    if zone == "research":
        if 9.0 <= h <= 19.5:
            return 0.95 if not is_weekend else 0.45
        return 0.18

    if zone == "canteen":
        if breakfast:
            return 1.2
        if lunch:
            return 1.6
        if dinner:
            return 1.4
        if 10.0 <= h <= 11.0 or 15.5 <= h <= 16.5:
            return 0.75
        return 0.25

    if zone == "residential":
        if 9.0 <= h <= 17.0 and not is_weekend:
            return 0.40
        return 0.85

    if zone == "venue":
        if 17.0 <= h <= 22.0:
            return 0.70
        return 0.15

    if zone == "gate":
        if is_weekend:
            return 0.40 if 9.0 <= h <= 18.0 else 0.20
        if rush:
            return 1.0
        if lunch:
            return 0.55
        return 0.35

    if zone == "road":
        if is_weekend:
            return 0.30
        if rush:
            return 0.80
        if in_class:
            return 0.45
        if lunch:
            return 0.85
        return 0.30

    return 0.50


class SeederState:
    def __init__(self, campus_total: int):
        self.campus_total = max(300, int(campus_total))
        self.current_counts: Dict[str, float] = {cam.camera_id: 0.0 for cam in CAMERAS}
        self.target_counts: Dict[str, float] = {cam.camera_id: 0.0 for cam in CAMERAS}

    def refresh_targets(self) -> None:
        h = _hour_float()
        weekday = datetime.now().weekday()

        active_ratio = 0.72
        if h < 6.0 or h >= 23.0:
            active_ratio = 0.90
        elif h < 7.5 or h >= 21.0:
            active_ratio = 0.68

        active_population = int(self.campus_total * active_ratio)

        weighted_scores: Dict[str, float] = {}
        total_score = 0.0

        for cam in CAMERAS:
            mult = _zone_multiplier(cam.zone, h, weekday)
            wave = 1.0 + 0.07 * math.sin((h / 24.0) * 2.0 * math.pi + (hash(cam.camera_id) % 9))
            jitter = random.uniform(0.92, 1.08)
            score = max(0.01, cam.base_weight * mult * wave * jitter)
            weighted_scores[cam.camera_id] = score
            total_score += score

        if total_score <= 0:
            total_score = 1.0

        for cam_id, score in weighted_scores.items():
            self.target_counts[cam_id] = (score / total_score) * active_population

    def step(self) -> None:
        for cam_id, current in self.current_counts.items():
            target = self.target_counts.get(cam_id, current)
            delta = target - current
            if abs(delta) < 0.5:
                self.current_counts[cam_id] = target
                continue

            step = max(1.0, min(16.0, abs(delta) * 0.24))
            self.current_counts[cam_id] = current + (step if delta > 0 else -step)

    def payload(self, node_id: str) -> Dict[str, object]:
        generated_at = datetime.now(timezone.utc).isoformat()
        readings = []

        for cam in CAMERAS:
            people_count = max(0, int(round(self.current_counts[cam.camera_id])))
            direction = "bidirectional"
            if cam.zone in {"gate", "road"}:
                direction = random.choice(["in", "out", "bidirectional"])

            readings.append(
                {
                    "camera_id": cam.camera_id,
                    "location_name": cam.location_name,
                    "zone": cam.zone,
                    "lat": cam.lat,
                    "lng": cam.lng,
                    "people_count": people_count,
                    "direction": direction,
                }
            )

        return {"node_id": node_id, "generated_at": generated_at, "readings": readings}


def _post_json(url: str, payload: Dict[str, object], timeout: float = 8.0) -> Dict[str, object]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def export_buildings(path: Path) -> None:
    payload = {
        "query_center": {"lat": DEFAULT_CENTER_LAT, "lng": DEFAULT_CENTER_LNG},
        "source": "user-mapped-priority-buildings",
        "count": len(BUILDINGS),
        "buildings": [asdict(item) for item in BUILDINGS],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def print_buildings() -> None:
    print("Priority buildings around 17.4464, 78.3487:")
    for idx, b in enumerate(BUILDINGS, start=1):
        print(f"{idx:02d}. {b.name} | lat={b.lat:.5f}, lng={b.lng:.5f} | hint={b.category_hint} | {b.note}")


async def run(backend: str, interval: float, campus_total: int, dry_run: bool) -> None:
    endpoint = f"{backend.rstrip('/')}/synthetic/nodes/ingest"
    state = SeederState(campus_total=campus_total)
    node_id = "iiith-poc-realistic-fixed"

    state.refresh_targets()
    print(f"Seeder endpoint: {endpoint if not dry_run else 'DRY-RUN'}")
    print(f"Buildings: {len(BUILDINGS)} | Cameras: {len(CAMERAS)} | Interval: {interval:.2f}s")
    print("Press Ctrl+C to stop")

    tick = 0
    while True:
        tick += 1
        if tick % 15 == 1:
            state.refresh_targets()
        state.step()

        payload = state.payload(node_id=node_id)
        total_people = int(sum(item["people_count"] for item in payload["readings"]))

        if dry_run:
            print(f"[dry-run] tick={tick:04d} people={total_people:4d} cameras={len(payload['readings'])}")
        else:
            try:
                result = await asyncio.to_thread(_post_json, endpoint, payload)
                inserted = int(result.get("inserted_rows", 0))
                print(
                    f"[{datetime.now().strftime('%H:%M:%S')}] "
                    f"tick={tick:04d} people={total_people:4d} cameras={len(payload['readings'])} posted={inserted}"
                )
            except urllib.error.URLError as exc:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] backend unavailable: {exc}")
            except Exception as exc:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] post failed: {exc}")

        await asyncio.sleep(max(0.2, interval))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="IIIT-H PoC realistic fixed-camera seeder")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help="Backend base URL")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between updates")
    parser.add_argument("--campus-total", type=int, default=4000, help="Campus headcount baseline")
    parser.add_argument("--dry-run", action="store_true", help="Generate output without POSTing")
    parser.add_argument(
        "--buildings-only",
        action="store_true",
        help="Print fixed building list and exit",
    )
    parser.add_argument(
        "--export-buildings",
        type=Path,
        default=None,
        help="Write the fixed building catalog to a JSON file and exit",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.buildings_only:
        print_buildings()
        return

    if args.export_buildings is not None:
        export_buildings(args.export_buildings)
        print(f"Exported building catalog to: {args.export_buildings}")
        return

    try:
        asyncio.run(
            run(
                backend=args.backend,
                interval=args.interval,
                campus_total=args.campus_total,
                dry_run=args.dry_run,
            )
        )
    except KeyboardInterrupt:
        print("Stopped by user")


if __name__ == "__main__":
    main()
