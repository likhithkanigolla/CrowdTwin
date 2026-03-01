#!/usr/bin/env python3
"""
Data Generator Script for Digital Twin Campus Visualization

This script generates realistic camera feed data and building occupancy data
for the campus digital twin system.

Usage:
  python data_generator.py --mode command    # Interactive mode (press Enter to send data)
  python data_generator.py --mode auto       # Automatic mode (60 data points per hour)
  python data_generator.py --mode schedule   # Schedule-based mode (follows campus schedule)
"""

import argparse
import asyncio
import httpx
import random
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import sys

# Backend API URL
API_BASE_URL = "http://localhost:8000"
OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_CENTER_LAT = 17.4464
DEFAULT_CENTER_LNG = 78.3487

# Campus buildings with their properties (coordinates are approximate)
BUILDINGS = {
    "hostels": {
        "names": ["NBH", "OBH", "Parijaat", "Bakul", "Kadamba"],
        "capacity": 500,
        "category": "hostel",
        "peak_hours": [(6, 8), (19, 23)],  # Morning and evening
        "lat": 17.4455,
        "lng": 78.3492,
    },
    "academic_block_a": {
        "names": ["Academic Block A", "LRC"],
        "capacity": 400,
        "category": "academic",
        "peak_hours": [(9, 12), (14, 17)],
        "lat": 17.4462,
        "lng": 78.3505,
    },
    "academic_block_b": {
        "names": ["Academic Block B", "Himalaya"],
        "capacity": 350,
        "category": "academic",
        "peak_hours": [(9, 12), (14, 17)],
        "lat": 17.4470,
        "lng": 78.3498,
    },
    "library": {
        "names": ["Library", "LRC"],
        "capacity": 200,
        "category": "academic",
        "peak_hours": [(10, 13), (15, 21)],
        "lat": 17.4458,
        "lng": 78.3510,
    },
    "canteen": {
        "names": ["Kadamba Canteen", "Yuktahar"],
        "capacity": 300,
        "category": "canteen",
        "peak_hours": [(8, 9), (12, 14), (19, 21)],
        "lat": 17.4465,
        "lng": 78.3488,
    },
    "sports_complex": {
        "names": ["Sports Complex", "Cricket Ground"],
        "capacity": 150,
        "category": "recreation",
        "peak_hours": [(6, 8), (17, 19)],
        "lat": 17.4448,
        "lng": 78.3515,
    },
    "admin_block": {
        "names": ["Admin Block", "KCIS"],
        "capacity": 100,
        "category": "admin",
        "peak_hours": [(9, 17)],
        "lat": 17.4475,
        "lng": 78.3502,
    },
    "main_gate": {
        "names": ["Main Gate"],
        "capacity": 50,
        "category": "gate",
        "peak_hours": [(7, 9), (17, 19)],
        "lat": 17.4440,
        "lng": 78.3480,
    },
}

# Cohort definitions
COHORTS = {
    "ug1": {"count": 600, "schedule_adherence": 0.9},
    "ug2": {"count": 550, "schedule_adherence": 0.85},
    "ug3": {"count": 500, "schedule_adherence": 0.8},
    "ug4": {"count": 400, "schedule_adherence": 0.7},
    "faculty": {"count": 80, "schedule_adherence": 0.95},
    "staff": {"count": 50, "schedule_adherence": 0.9},
}

# Campus schedule template (hour -> expected movement patterns)
CAMPUS_SCHEDULE = {
    0: {"primary": "hostels", "secondary": None, "activity": "sleeping"},
    1: {"primary": "hostels", "secondary": None, "activity": "sleeping"},
    2: {"primary": "hostels", "secondary": None, "activity": "sleeping"},
    3: {"primary": "hostels", "secondary": None, "activity": "sleeping"},
    4: {"primary": "hostels", "secondary": None, "activity": "sleeping"},
    5: {"primary": "hostels", "secondary": None, "activity": "sleeping"},
    6: {"primary": "hostels", "secondary": "sports_complex", "activity": "morning_routine"},
    7: {"primary": "hostels", "secondary": "canteen", "activity": "breakfast"},
    8: {"primary": "academic_block_a", "secondary": "canteen", "activity": "classes_start"},
    9: {"primary": "academic_block_a", "secondary": "academic_block_b", "activity": "classes"},
    10: {"primary": "academic_block_a", "secondary": "library", "activity": "classes"},
    11: {"primary": "academic_block_a", "secondary": "academic_block_b", "activity": "classes"},
    12: {"primary": "canteen", "secondary": "hostels", "activity": "lunch"},
    13: {"primary": "canteen", "secondary": "library", "activity": "lunch_break"},
    14: {"primary": "academic_block_b", "secondary": "academic_block_a", "activity": "afternoon_classes"},
    15: {"primary": "academic_block_b", "secondary": "library", "activity": "classes"},
    16: {"primary": "academic_block_a", "secondary": "library", "activity": "classes"},
    17: {"primary": "hostels", "secondary": "sports_complex", "activity": "evening_break"},
    18: {"primary": "sports_complex", "secondary": "hostels", "activity": "recreation"},
    19: {"primary": "canteen", "secondary": "hostels", "activity": "dinner"},
    20: {"primary": "hostels", "secondary": "library", "activity": "evening_study"},
    21: {"primary": "hostels", "secondary": "library", "activity": "night_study"},
    22: {"primary": "hostels", "secondary": "library", "activity": "night_study"},
    23: {"primary": "hostels", "secondary": None, "activity": "sleeping"},
}


def get_current_hour() -> int:
    """Get current hour (0-23)"""
    return datetime.now().hour


def calculate_building_occupancy(building_id: str, hour: int) -> int:
    """Calculate expected occupancy for a building at a given hour."""
    building = BUILDINGS.get(building_id)
    if not building:
        return 0
    
    capacity = building["capacity"]
    peak_hours = building.get("peak_hours", [])
    
    # Base occupancy (20-30% of capacity)
    base_occupancy = int(capacity * random.uniform(0.2, 0.3))
    
    # Check if current hour is peak
    is_peak = any(start <= hour < end for start, end in peak_hours)
    
    if is_peak:
        # Peak hours: 60-90% capacity
        return int(capacity * random.uniform(0.6, 0.9))
    
    # Check if it's adjacent to peak hours (transition)
    is_transition = any(
        (start - 1 <= hour < start) or (end <= hour < end + 1)
        for start, end in peak_hours
    )
    
    if is_transition:
        # Transition hours: 40-60% capacity
        return int(capacity * random.uniform(0.4, 0.6))
    
    return base_occupancy


def generate_camera_data(camera_id: str, building_id: str, hour: int) -> Dict:
    """Generate camera feed data for a specific camera."""
    building = BUILDINGS.get(building_id, {})
    people_count = calculate_building_occupancy(building_id, hour)
    
    # Add some noise/variation
    people_count = max(0, people_count + random.randint(-10, 10))
    
    # Use the first name as location_name
    location_name = building.get("names", [building_id])[0]
    
    return {
        "camera_id": camera_id,
        "location_name": location_name,
        "lat": building.get("lat", 17.445),
        "lng": building.get("lng", 78.349),
        "people_count": people_count,
        "direction": random.choice(["in", "out", "bidirectional"]),
        "timestamp": datetime.now().isoformat()
    }


def generate_building_occupancy(hour: int) -> Dict[str, int]:
    """Generate occupancy data for all buildings at a given hour."""
    schedule_info = CAMPUS_SCHEDULE.get(hour, {})
    primary_location = schedule_info.get("primary")
    secondary_location = schedule_info.get("secondary")
    
    occupancy = {}
    
    for building_id, building_data in BUILDINGS.items():
        base = calculate_building_occupancy(building_id, hour)
        
        # Boost if primary location
        if building_id == primary_location:
            base = int(base * 1.5)
        elif building_id == secondary_location:
            base = int(base * 1.2)
        
        occupancy[building_id] = min(base, building_data["capacity"])
    
    return occupancy


def generate_movement_event(hour: int) -> Optional[Dict]:
    """Generate a movement event between buildings."""
    schedule_info = CAMPUS_SCHEDULE.get(hour, {})
    activity = schedule_info.get("activity", "")
    
    # Determine movement based on activity
    if "classes" in activity:
        from_options = ["hostels", "canteen"]
        to_options = ["academic_block_a", "academic_block_b", "library"]
    elif activity == "lunch" or activity == "dinner":
        from_options = ["academic_block_a", "academic_block_b", "library"]
        to_options = ["canteen", "hostels"]
    elif "morning" in activity:
        from_options = ["hostels"]
        to_options = ["canteen", "sports_complex"]
    elif "evening" in activity or "recreation" in activity:
        from_options = ["academic_block_a", "academic_block_b"]
        to_options = ["hostels", "sports_complex", "canteen"]
    else:
        return None
    
    from_building = random.choice(from_options)
    to_building = random.choice(to_options)
    
    if from_building == to_building:
        return None
    
    count = random.randint(5, 30)
    
    return {
        "from_building": from_building,
        "to_building": to_building,
        "count": count,
        "timestamp": datetime.now().isoformat()
    }


async def send_camera_data(client: httpx.AsyncClient, data: Dict) -> bool:
    """Send camera data to backend API."""
    try:
        # API expects CameraFeedUpdate with cameras array
        payload = {
            "cameras": [data],
            "timestamp": datetime.now().isoformat()
        }
        response = await client.post(f"{API_BASE_URL}/camera-feed", json=payload)
        return response.status_code == 200
    except Exception as e:
        print(f"Error sending camera data: {e}")
        return False


async def send_building_occupancy(client: httpx.AsyncClient, building_id: str, count: int) -> bool:
    """Send building occupancy data to backend API."""
    try:
        building = BUILDINGS.get(building_id, {})
        # Use the first name as building_name
        building_name = building.get("names", [building_id])[0]
        
        # API expects BuildingOccupancyUpdate schema
        payload = {
            "building_name": building_name,
            "current_occupancy": count,
            "capacity": building.get("capacity"),
            "last_updated": datetime.now().isoformat()
        }
        response = await client.post(
            f"{API_BASE_URL}/building-occupancy",
            json=payload
        )
        return response.status_code == 200
    except Exception as e:
        print(f"Error sending occupancy data: {e}")
        return False


async def bootstrap_roads_from_osm(client: httpx.AsyncClient, center_lat: float = DEFAULT_CENTER_LAT, center_lng: float = DEFAULT_CENTER_LNG) -> None:
    """Fetch nearby road features from OpenStreetMap and register 10 service roads with backend."""
    overpass_query = f"""
    [out:json][timeout:25];
    (
      way["highway"](around:350,{center_lat},{center_lng});
    );
    out body;
    """

    try:
        osm_response = await client.post(OVERPASS_API_URL, data=overpass_query, timeout=30.0)
        if osm_response.status_code != 200:
            print(f"⚠️  Could not fetch OSM roads (status {osm_response.status_code})")
            return

        payload = osm_response.json()
        elements = payload.get("elements", [])

        service_roads = []
        fallback_roads = []

        for elem in elements:
            if elem.get("type") != "way":
                continue
            tags = elem.get("tags", {})
            highway = tags.get("highway")
            if not highway:
                continue
            entry = {
                "name": tags.get("name"),
                "highway": highway,
            }
            if highway == "service":
                service_roads.append(entry)
            else:
                fallback_roads.append(entry)

        selected = service_roads[:10]
        if len(selected) < 10:
            selected.extend(fallback_roads[: 10 - len(selected)])

        roads_payload = []
        for idx, road in enumerate(selected, start=1):
            roads_payload.append({
                "road_id": f"service_{idx}",
                "road_name": f"Service Road {idx}",
                "road_type": road.get("highway", "path"),
            })

        if roads_payload:
            register_response = await client.post(f"{API_BASE_URL}/roads/register", json=roads_payload)
            if register_response.status_code == 200:
                print(f"🛣️  Registered {len(roads_payload)} OSM-derived roads near {center_lat}, {center_lng}")
            else:
                print(f"⚠️  Failed to register roads (status {register_response.status_code})")
    except Exception as e:
        print(f"⚠️  OSM bootstrap skipped: {e}")


async def run_command_mode():
    """Interactive mode - sends data when user presses Enter."""
    print("\n" + "="*60)
    print("📡 COMMAND MODE - Press Enter to send data, 'q' to quit")
    print("="*60 + "\n")
    
    async with httpx.AsyncClient() as client:
        await bootstrap_roads_from_osm(client)
        while True:
            user_input = input("\n[Press Enter to send data, 'q' to quit]: ")
            if user_input.lower() == 'q':
                print("Exiting...")
                break
            
            hour = get_current_hour()
            print(f"\n⏰ Current hour: {hour}:00")
            print(f"📋 Activity: {CAMPUS_SCHEDULE.get(hour, {}).get('activity', 'unknown')}")
            
            # Generate and send data
            occupancy = generate_building_occupancy(hour)
            print(f"\n📊 Building Occupancy:")
            
            for building_id, count in occupancy.items():
                success = await send_building_occupancy(client, building_id, count)
                status = "✓" if success else "✗"
                building_names = BUILDINGS[building_id]["names"][0]
                print(f"  {status} {building_names}: {count} people")
            
            # Generate camera feeds
            print(f"\n📹 Camera Feeds:")
            for building_id in list(BUILDINGS.keys())[:5]:  # First 5 buildings
                camera_id = f"cam_{building_id}_entrance"
                data = generate_camera_data(camera_id, building_id, hour)
                success = await send_camera_data(client, data)
                status = "✓" if success else "✗"
                print(f"  {status} {camera_id}: {data['people_count']} people ({data['direction']})")
            
            # Generate movement event
            movement = generate_movement_event(hour)
            if movement:
                print(f"\n🚶 Movement Event:")
                print(f"  {movement['from_building']} → {movement['to_building']}: {movement['count']} people")


async def run_auto_mode():
    """Automatic mode - sends 60 data points per hour (1 per minute)."""
    print("\n" + "="*60)
    print("🤖 AUTO MODE - Sending data every minute (60 points/hour)")
    print("="*60 + "\n")
    
    async with httpx.AsyncClient() as client:
        await bootstrap_roads_from_osm(client)
        data_point_count = 0
        
        while True:
            hour = get_current_hour()
            minute = datetime.now().minute
            data_point_count += 1
            
            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Data point #{data_point_count}")
            print(f"⏰ Time: {hour:02d}:{minute:02d}")
            
            # Generate occupancy
            occupancy = generate_building_occupancy(hour)
            
            # Send building occupancy
            for building_id, count in occupancy.items():
                # Add per-minute variation
                variation = random.randint(-5, 5)
                adjusted_count = max(0, count + variation)
                await send_building_occupancy(client, building_id, adjusted_count)
            
            print(f"📊 Updated {len(occupancy)} buildings")
            
            # Send camera feeds for active buildings
            active_cameras = 0
            for building_id in BUILDINGS.keys():
                if random.random() < 0.7:  # 70% chance camera sends update
                    camera_id = f"cam_{building_id}_entrance"
                    data = generate_camera_data(camera_id, building_id, hour)
                    await send_camera_data(client, data)
                    active_cameras += 1
            
            print(f"📹 Updated {active_cameras} cameras")
            
            # Movement events (30% chance per minute)
            if random.random() < 0.3:
                movement = generate_movement_event(hour)
                if movement:
                    print(f"🚶 Movement: {movement['from_building']} → {movement['to_building']} ({movement['count']} people)")
            
            # Wait for next minute
            print("⏳ Waiting 60 seconds...")
            await asyncio.sleep(60)


async def run_schedule_mode():
    """Schedule-based mode - follows campus schedule with realistic patterns."""
    print("\n" + "="*60)
    print("📅 SCHEDULE MODE - Following campus schedule")
    print("="*60 + "\n")
    
    # Print schedule overview
    print("Campus Schedule Overview:")
    for hour, info in CAMPUS_SCHEDULE.items():
        print(f"  {hour:02d}:00 - {info['activity']} @ {info['primary']}")
    print()
    
    async with httpx.AsyncClient() as client:
        await bootstrap_roads_from_osm(client)
        last_hour = -1
        
        while True:
            hour = get_current_hour()
            minute = datetime.now().minute
            
            # Announce hour change
            if hour != last_hour:
                last_hour = hour
                schedule_info = CAMPUS_SCHEDULE.get(hour, {})
                print(f"\n{'='*50}")
                print(f"🕐 HOUR CHANGE: {hour:02d}:00")
                print(f"📋 Activity: {schedule_info.get('activity', 'unknown')}")
                print(f"📍 Primary: {schedule_info.get('primary', 'N/A')}")
                print(f"📍 Secondary: {schedule_info.get('secondary', 'N/A')}")
                print(f"{'='*50}\n")
            
            # Generate realistic data based on schedule
            occupancy = generate_building_occupancy(hour)
            
            print(f"[{hour:02d}:{minute:02d}] Updating occupancy...")
            
            for building_id, count in occupancy.items():
                await send_building_occupancy(client, building_id, count)
            
            # Camera updates every 30 seconds
            for building_id in BUILDINGS.keys():
                camera_id = f"cam_{building_id}_entrance"
                data = generate_camera_data(camera_id, building_id, hour)
                await send_camera_data(client, data)
            
            # Movement events at transition times
            if minute in [0, 15, 30, 45]:
                movement = generate_movement_event(hour)
                if movement:
                    print(f"🚶 Movement detected: {movement['count']} people from {movement['from_building']} to {movement['to_building']}")
            
            # Wait 30 seconds
            await asyncio.sleep(30)


def main():
    parser = argparse.ArgumentParser(
        description="Data Generator for Digital Twin Campus",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python data_generator.py --mode command    # Interactive mode
  python data_generator.py --mode auto       # Automatic updates every minute
  python data_generator.py --mode schedule   # Schedule-based realistic mode
        """
    )
    parser.add_argument(
        "--mode",
        choices=["command", "auto", "schedule"],
        default="command",
        help="Operating mode (default: command)"
    )
    parser.add_argument(
        "--api-url",
        default="http://localhost:8000",
        help="Backend API URL (default: http://localhost:8000)"
    )
    
    args = parser.parse_args()
    
    global API_BASE_URL
    API_BASE_URL = args.api_url
    
    print(f"\n🎮 Digital Twin Data Generator")
    print(f"📡 API URL: {API_BASE_URL}")
    print(f"⚙️  Mode: {args.mode}")
    
    if args.mode == "command":
        asyncio.run(run_command_mode())
    elif args.mode == "auto":
        asyncio.run(run_auto_mode())
    elif args.mode == "schedule":
        asyncio.run(run_schedule_mode())


if __name__ == "__main__":
    main()
