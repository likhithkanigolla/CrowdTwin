#!/usr/bin/env python3
"""
Synthetic node providers for CrowdTwin visualization mode.

Run this script to simulate distributed data-provider nodes posting camera
readings into the backend SQLite store via /synthetic/nodes/ingest.

Example:
  python3 synthetic_nodes.py --backend http://localhost:8904 --interval 2
"""

import argparse
import asyncio
import json
import math
import random
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Dict, List


DEFAULT_BACKEND = "http://localhost:8904"

NODES = [
    {
        "id": "node-hostels",
        "cameras": [
            {"camera_id": "cam_h1", "location_name": "NBH Entrance", "zone": "hostels", "lat": 17.4455, "lng": 78.3492},
            {"camera_id": "cam_h2", "location_name": "OBH Entrance", "zone": "hostels", "lat": 17.4452, "lng": 78.3496},
        ],
    },
    {
        "id": "node-academic",
        "cameras": [
            {"camera_id": "cam_a1", "location_name": "Academic Block A", "zone": "academics", "lat": 17.4462, "lng": 78.3505},
            {"camera_id": "cam_a2", "location_name": "Academic Block B", "zone": "academics", "lat": 17.4470, "lng": 78.3498},
            {"camera_id": "cam_lib", "location_name": "Library", "zone": "academics", "lat": 17.4458, "lng": 78.3510},
        ],
    },
    {
        "id": "node-services",
        "cameras": [
            {"camera_id": "cam_c1", "location_name": "Kadamba Canteen", "zone": "canteens", "lat": 17.4465, "lng": 78.3488},
            {"camera_id": "cam_gate", "location_name": "Main Gate", "zone": "gates", "lat": 17.4440, "lng": 78.3480},
            {"camera_id": "cam_admin", "location_name": "Admin Block", "zone": "admin", "lat": 17.4475, "lng": 78.3502},
        ],
    },
]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hour_factor(zone: str, hour: int) -> float:
    if zone == "hostels":
        if hour < 7 or hour >= 20:
            return 1.15
        if 7 <= hour < 10:
            return 0.6
        return 0.75

    if zone == "academics":
        if 9 <= hour < 17:
            return 1.2
        if 17 <= hour < 20:
            return 0.5
        return 0.25

    if zone == "canteens":
        if hour in (8, 9, 12, 13, 19, 20):
            return 1.25
        return 0.45

    if zone == "gates":
        if hour in (8, 9, 17, 18):
            return 1.1
        return 0.35

    if zone == "admin":
        return 0.95 if 9 <= hour < 17 else 0.25

    return 0.5


def _base_zone_count(zone: str) -> int:
    return {
        "hostels": 180,
        "academics": 240,
        "canteens": 110,
        "gates": 60,
        "admin": 45,
    }.get(zone, 50)


def _camera_count(zone: str, seed: float, hour: int) -> int:
    base = _base_zone_count(zone)
    factor = _hour_factor(zone, hour)
    wave = 1.0 + 0.12 * math.sin(seed + (hour / 24.0) * math.pi * 2)
    jitter = random.uniform(0.85, 1.18)
    return max(0, int(base * factor * wave * jitter))


def _build_payload(node: Dict[str, object]) -> Dict[str, object]:
    now = datetime.now()
    hour = now.hour
    generated_at = _utc_now_iso()
    readings: List[Dict[str, object]] = []

    for idx, camera in enumerate(node["cameras"]):
        zone = str(camera["zone"])
        count = _camera_count(zone, seed=float(idx + 1) * 1.3, hour=hour)
        readings.append(
            {
                "camera_id": camera["camera_id"],
                "location_name": camera["location_name"],
                "zone": zone,
                "lat": camera["lat"],
                "lng": camera["lng"],
                "people_count": count,
                "direction": random.choice(["in", "out", "bidirectional"]),
            }
        )

    return {
        "node_id": node["id"],
        "generated_at": generated_at,
        "readings": readings,
    }


def _post_json(url: str, payload: Dict[str, object], timeout: float = 6.0) -> Dict[str, object]:
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


async def _run_node(node: Dict[str, object], backend: str, interval: float, stop_event: asyncio.Event):
    endpoint = f"{backend.rstrip('/')}/synthetic/nodes/ingest"
    node_id = str(node["id"])

    while not stop_event.is_set():
        payload = _build_payload(node)
        try:
            result = await asyncio.to_thread(_post_json, endpoint, payload)
            print(f"[{_utc_now_iso()}] {node_id}: inserted {result.get('inserted_rows', 0)} rows")
        except urllib.error.URLError as exc:
            print(f"[{_utc_now_iso()}] {node_id}: backend unavailable ({exc})")
        except Exception as exc:
            print(f"[{_utc_now_iso()}] {node_id}: post failed ({exc})")

        sleep_for = interval + random.uniform(0.0, max(0.1, interval * 0.2))
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=sleep_for)
        except asyncio.TimeoutError:
            pass


async def main_async(args):
    stop_event = asyncio.Event()

    tasks = [
        asyncio.create_task(_run_node(node=node, backend=args.backend, interval=args.interval, stop_event=stop_event))
        for node in NODES
    ]

    print(f"Starting {len(tasks)} synthetic nodes -> {args.backend.rstrip('/')}/synthetic/nodes/ingest")
    print("Press Ctrl+C to stop")

    try:
        if args.duration > 0:
            await asyncio.sleep(args.duration)
            stop_event.set()
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        stop_event.set()
        await asyncio.gather(*tasks, return_exceptions=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Run synthetic data provider nodes for CrowdTwin")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help="Backend base URL")
    parser.add_argument("--interval", type=float, default=2.0, help="Seconds between node posts")
    parser.add_argument("--duration", type=float, default=0.0, help="Run duration in seconds (0 = until Ctrl+C)")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    asyncio.run(main_async(arguments))
