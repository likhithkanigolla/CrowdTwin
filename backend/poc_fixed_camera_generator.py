#!/usr/bin/env python3
"""
PoC Fixed Camera Generator

Hardcoded camera layout for the user-mapped IIIT-H locations.
Posts synthetic camera readings every second to:
  POST /synthetic/nodes/ingest

Design goals for PoC:
- Fixed hardcoded cameras across mapped buildings + important roads.
- Crowd values update every second.
- Counts change gradually so frontend movement appears smooth.
- Cameras with persistent occupancy keep agents concentrated at that location.

Usage:
  python poc_fixed_camera_generator.py
  python poc_fixed_camera_generator.py --backend http://localhost:8904 --interval 1 --campus-total 4000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List


DEFAULT_BACKEND = "http://localhost:8904"


@dataclass(frozen=True)
class CameraPoint:
    camera_id: str
    location_name: str
    zone: str
    lat: float
    lng: float
    base_weight: float


# User-mapped buildings and key roads around them.
CAMERAS: List[CameraPoint] = [
    CameraPoint("cam_obh_ff_gate", "OBH-FF Entrance", "hostels", 17.44476, 78.34572, 1.2),
    CameraPoint("cam_block_e", "Block E, Faculty and Staff Quarters", "residential", 17.44434, 78.34796, 0.9),
    CameraPoint("cam_block_d", "Block D, Faculty and Staff Quarters", "residential", 17.44385, 78.34777, 0.9),
    CameraPoint("cam_ananda_nivas", "Ananda Nivas", "residential", 17.44397, 78.34848, 1.0),
    CameraPoint("cam_block_c", "Block C, Faculty and Staff QUarters", "residential", 17.44334, 78.34783, 0.9),
    CameraPoint("cam_buddha_nivas", "Buddha Nivas", "residential", 17.44331, 78.34852, 0.95),
    CameraPoint("cam_academic_office", "Academic Office", "research", 17.44495, 78.34989, 1.05),
    CameraPoint("cam_himalaya", "Himalaya", "academics", 17.44544, 78.34913, 1.4),
    CameraPoint("cam_t_hub", "T-Hub", "research", 17.44568, 78.34882, 1.1),
    CameraPoint("cam_girls_639403216", "Building #639403216", "girls_hostel", 17.44699, 78.34685, 1.25),
    CameraPoint("cam_girls_639403215", "Building #639403215", "girls_hostel", 17.44730, 78.34715, 1.25),
    CameraPoint("cam_girls_hostel_main", "Girls Hostel", "girls_hostel", 17.44757, 78.34741, 1.3),
    CameraPoint("cam_amphitheater", "Amphitheater", "venue", 17.44797, 78.34791, 1.0),
    CameraPoint("cam_juice_canteen", "Juice Canteen", "canteens", 17.44793, 78.34758, 1.2),
    CameraPoint("cam_basketball_canteen", "Basketball Canteen", "canteens", 17.44785, 78.34753, 1.2),
    CameraPoint("cam_bakul_nivas", "Bakul Nivas", "hostels", 17.44819, 78.34850, 1.15),
    CameraPoint("cam_main_gate", "SBI ATM - IIIT Hyderabad Main Gate", "gates", 17.44584, 78.35158, 1.1),
    # Road cameras
    CameraPoint("cam_road_himalaya_t_hub", "Road: Himalaya <-> T-Hub", "roads", 17.44556, 78.34898, 1.0),
    CameraPoint("cam_road_hostel_axis", "Road: Girls Hostel Axis", "roads", 17.44735, 78.34772, 1.0),
    CameraPoint("cam_road_residential_axis", "Road: Residential Blocks Axis", "roads", 17.44370, 78.34805, 0.95),
]


ZONE_HOURLY_MULTIPLIER = {
    "hostels": lambda h: 1.2 if (h < 8 or h >= 19) else 0.85,
    "girls_hostel": lambda h: 1.15 if (h < 8 or h >= 19) else 0.8,
    "academics": lambda h: 1.35 if 8 <= h < 17 else 0.45,
    "research": lambda h: 1.1 if 9 <= h < 19 else 0.5,
    "canteens": lambda h: 1.5 if h in {8, 9, 12, 13, 19, 20} else 0.55,
    "venue": lambda h: 1.1 if 16 <= h < 22 else 0.35,
    "residential": lambda h: 1.0,
    "gates": lambda h: 1.25 if h in {8, 9, 17, 18, 19} else 0.5,
    "roads": lambda h: 1.0,
}


class GeneratorState:
    def __init__(self, campus_total: int):
        self.campus_total = max(200, int(campus_total))
        self.current_counts: Dict[str, float] = {camera.camera_id: 0.0 for camera in CAMERAS}
        self.target_counts: Dict[str, float] = {camera.camera_id: 0.0 for camera in CAMERAS}

    @staticmethod
    def _utc_now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _zone_multiplier(self, zone: str, hour: int) -> float:
        fn = ZONE_HOURLY_MULTIPLIER.get(zone, lambda _: 1.0)
        return float(fn(hour))

    def refresh_targets(self) -> None:
        now = datetime.now()
        hour = now.hour

        weighted_scores: Dict[str, float] = {}
        total_score = 0.0

        for camera in CAMERAS:
            multiplier = self._zone_multiplier(camera.zone, hour)
            wave = 1.0 + 0.08 * math.sin((now.minute / 60.0) * 2.0 * math.pi + hash(camera.camera_id) % 7)
            jitter = random.uniform(0.9, 1.1)
            score = max(0.05, camera.base_weight * multiplier * wave * jitter)
            weighted_scores[camera.camera_id] = score
            total_score += score

        if total_score <= 0:
            total_score = 1.0

        # Scale values to a PoC portion of campus headcount.
        active_population = int(self.campus_total * 0.45)
        for camera_id, score in weighted_scores.items():
            self.target_counts[camera_id] = (score / total_score) * active_population

    def step_counts(self) -> None:
        # Move slowly towards target each tick, so frontend movement appears smooth.
        for camera_id, current in self.current_counts.items():
            target = self.target_counts.get(camera_id, current)
            delta = target - current
            if abs(delta) < 0.5:
                self.current_counts[camera_id] = target
                continue

            step = max(1.0, min(14.0, abs(delta) * 0.22))
            self.current_counts[camera_id] = current + (step if delta > 0 else -step)

    def make_payload(self, node_id: str) -> Dict[str, object]:
        now = self._utc_now_iso()
        readings = []

        for camera in CAMERAS:
            count = max(0, int(round(self.current_counts[camera.camera_id])))
            direction = "bidirectional"
            if camera.zone in {"gates", "roads"}:
                direction = random.choice(["in", "out", "bidirectional"])

            readings.append(
                {
                    "camera_id": camera.camera_id,
                    "location_name": camera.location_name,
                    "zone": camera.zone,
                    "lat": camera.lat,
                    "lng": camera.lng,
                    "people_count": count,
                    "direction": direction,
                }
            )

        return {
            "node_id": node_id,
            "generated_at": now,
            "readings": readings,
        }


def _post_json(url: str, payload: Dict[str, object], timeout: float = 8.0) -> Dict[str, object]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


async def run_generator(backend: str, interval: float, campus_total: int) -> None:
    endpoint = f"{backend.rstrip('/')}/synthetic/nodes/ingest"
    node_id = "poc-fixed-cameras"
    state = GeneratorState(campus_total=campus_total)

    state.refresh_targets()
    print(f"Starting PoC fixed camera generator -> {endpoint}")
    print(f"Cameras: {len(CAMERAS)} | interval: {interval:.2f}s | campus_total: {campus_total}")
    print("Press Ctrl+C to stop")

    tick = 0
    while True:
        tick += 1
        if tick % 20 == 1:
            state.refresh_targets()

        state.step_counts()
        payload = state.make_payload(node_id=node_id)

        try:
            result = await asyncio.to_thread(_post_json, endpoint, payload)
            inserted = int(result.get("inserted_rows", 0))
            total_people = int(sum(item["people_count"] for item in payload["readings"]))
            print(f"[{payload['generated_at']}] posted={inserted} cameras={len(payload['readings'])} people={total_people}")
        except urllib.error.URLError as exc:
            print(f"[{state._utc_now_iso()}] backend unavailable: {exc}")
        except Exception as exc:
            print(f"[{state._utc_now_iso()}] post failed: {exc}")

        await asyncio.sleep(max(0.2, interval))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Hardcoded PoC camera generator for CrowdTwin")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help="Backend base URL")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between updates")
    parser.add_argument("--campus-total", type=int, default=4000, help="Campus headcount baseline")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(run_generator(args.backend, args.interval, args.campus_total))
    except KeyboardInterrupt:
        print("Stopped by user")


if __name__ == "__main__":
    main()
