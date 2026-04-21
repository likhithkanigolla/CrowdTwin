"""
Database operations for allocation engine using PostgreSQL + psycopg2.
Replaces in-memory stores with direct DB queries.

NOTE: psycopg2 automatically converts JSONB columns to Python dicts,
so we don't need to call json.loads() on them.
"""

import json
from uuid import uuid4
from models import get_db_cursor


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def _now_iso() -> str:
    from datetime import datetime
    return datetime.now().isoformat()


def _ensure_dict(val):
    """Convert JSON string to dict if needed (psycopg2 JSONB is already dict)."""
    if val is None:
        return None
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        return json.loads(val)
    return val


# ============= SITES =============

def create_site(name: str, geoBoundary: dict = None) -> dict:
    """Create a site in database."""
    site_id = _new_id("site")
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO sites (id, name, geoBoundary) VALUES (%s, %s, %s) RETURNING id, name, geoBoundary, createdAt",
            (site_id, name, json.dumps(geoBoundary) if geoBoundary else None)
        )
        result = cur.fetchone()
    return {
        "id": result[0],
        "name": result[1],
        "geoBoundary": _ensure_dict(result[2]),
        "createdAt": str(result[3]),
    }


def get_sites() -> list:
    """Get all sites."""
    with get_db_cursor() as cur:
        cur.execute("SELECT id, name, geoBoundary, createdAt FROM sites ORDER BY createdAt DESC")
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "name": row[1],
            "geoBoundary": _ensure_dict(row[2]),
            "createdAt": str(row[3]),
        }
        for row in rows
    ]


# ============= BUILDINGS =============

def create_building(siteId: str, name: str, location: dict = None, category: str = None) -> dict:
    """Create a building in database."""
    building_id = _new_id("building")
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO buildings (id, siteId, name, location, category) VALUES (%s, %s, %s, %s, %s) RETURNING id, siteId, name, location, category, createdAt",
            (building_id, siteId, name, json.dumps(location) if location else None, category)
        )
        result = cur.fetchone()
    return {
        "id": result[0],
        "siteId": result[1],
        "name": result[2],
        "location": _ensure_dict(result[3]),
        "category": result[4],
        "createdAt": str(result[5]),
    }


def get_buildings(siteId: str = None) -> list:
    """Get buildings, optionally filtered by siteId."""
    with get_db_cursor() as cur:
        if siteId:
            cur.execute("SELECT id, siteId, name, location, category, createdAt FROM buildings WHERE siteId = %s", (siteId,))
        else:
            cur.execute("SELECT id, siteId, name, location, category, createdAt FROM buildings")
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "siteId": row[1],
            "name": row[2],
            "location": _ensure_dict(row[3]),
            "category": row[4],
            "createdAt": str(row[5]),
        }
        for row in rows
    ]


# ============= ROOMS =============

def create_room(buildingId: str, name: str, floor: str = None, capacity: int = None, roomType: str = None, status: str = "available", accessibilityScore: float = 0.7, estimatedCost: float = 0.0) -> dict:
    """Create a room in database."""
    room_id = _new_id("room")
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO rooms (id, buildingId, name, floor, capacity, roomType, status, accessibilityScore, estimatedCost) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, buildingId, name, floor, capacity, roomType, status, accessibilityScore, estimatedCost, createdAt",
            (room_id, buildingId, name, floor, capacity, roomType, status, accessibilityScore, estimatedCost)
        )
        result = cur.fetchone()
    return {
        "id": result[0],
        "buildingId": result[1],
        "name": result[2],
        "floor": result[3],
        "capacity": result[4],
        "roomType": result[5],
        "status": result[6],
        "accessibilityScore": result[7],
        "estimatedCost": result[8],
        "createdAt": str(result[9]),
    }


def get_rooms(buildingId: str = None) -> list:
    """Get rooms, optionally filtered by buildingId."""
    with get_db_cursor() as cur:
        if buildingId:
            cur.execute("SELECT id, buildingId, name, floor, capacity, roomType, status, accessibilityScore, estimatedCost, createdAt FROM rooms WHERE buildingId = %s", (buildingId,))
        else:
            cur.execute("SELECT id, buildingId, name, floor, capacity, roomType, status, accessibilityScore, estimatedCost, createdAt FROM rooms")
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "buildingId": row[1],
            "name": row[2],
            "floor": row[3],
            "capacity": row[4],
            "roomType": row[5],
            "status": row[6],
            "accessibilityScore": row[7],
            "estimatedCost": row[8],
            "createdAt": str(row[9]),
        }
        for row in rows
    ]


def get_room_by_name(room_name: str) -> dict:
    """Get a room by name."""
    with get_db_cursor() as cur:
        cur.execute("SELECT id, buildingId, name, floor, capacity, roomType, status, accessibilityScore, estimatedCost, createdAt FROM rooms WHERE name = %s LIMIT 1", (room_name,))
        result = cur.fetchone()
    if not result:
        return None
    return {
        "id": result[0],
        "buildingId": result[1],
        "name": result[2],
        "floor": result[3],
        "capacity": result[4],
        "roomType": result[5],
        "status": result[6],
        "accessibilityScore": result[7],
        "estimatedCost": result[8],
        "createdAt": str(result[9]),
    }


# ============= EVENT TYPES =============

def create_event_type(name: str, isCustom: bool = False) -> dict:
    """Create an event type in database."""
    etype_id = _new_id("eventtype")
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO event_types (id, name, isCustom) VALUES (%s, %s, %s) RETURNING id, name, isCustom, createdAt",
            (etype_id, name, isCustom)
        )
        result = cur.fetchone()
    return {
        "id": result[0],
        "name": result[1],
        "isCustom": result[2],
        "createdAt": str(result[3]),
    }


def get_event_types() -> list:
    """Get all event types."""
    with get_db_cursor() as cur:
        cur.execute("SELECT id, name, isCustom, createdAt FROM event_types")
        rows = cur.fetchall()
    return [
        {
            "id": row[0],
            "name": row[1],
            "isCustom": row[2],
            "createdAt": str(row[3]),
        }
        for row in rows
    ]


# ============= EVENT PROFILES =============

def create_event_profile(eventTypeId: str, configJson: dict) -> dict:
    """Create or update an event profile in database."""
    with get_db_cursor() as cur:
        # Check if profile exists
        cur.execute("SELECT id FROM event_profiles WHERE eventTypeId = %s LIMIT 1", (eventTypeId,))
        existing = cur.fetchone()
        
        if existing:
            # Update
            profile_id = existing[0]
            cur.execute(
                "UPDATE event_profiles SET configJson = %s WHERE id = %s RETURNING id, eventTypeId, configJson, createdAt",
                (json.dumps(configJson), profile_id)
            )
        else:
            # Create new
            profile_id = _new_id("profile")
            cur.execute(
                "INSERT INTO event_profiles (id, eventTypeId, configJson) VALUES (%s, %s, %s) RETURNING id, eventTypeId, configJson, createdAt",
                (profile_id, eventTypeId, json.dumps(configJson))
            )
        
        result = cur.fetchone()
    
    return {
        "id": result[0],
        "eventTypeId": result[1],
        "configJson": _ensure_dict(result[2]),
        "createdAt": str(result[3]),
    }


def get_event_profile(eventTypeId: str) -> dict:
    """Get an event profile by event type."""
    with get_db_cursor() as cur:
        cur.execute("SELECT id, eventTypeId, configJson, createdAt FROM event_profiles WHERE eventTypeId = %s LIMIT 1", (eventTypeId,))
        result = cur.fetchone()
    
    if not result:
        return None
    
    return {
        "id": result[0],
        "eventTypeId": result[1],
        "configJson": _ensure_dict(result[2]),
        "createdAt": str(result[3]),
    }


# ============= BOOKINGS =============

def create_booking(siteId: str, eventName: str, eventTypeId: str, expectedAttendance: int, startAt: str, endAt: str, status: str = "confirmed", buildingScope: list = None) -> dict:
    """Create a booking in database."""
    booking_id = _new_id("booking")
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO bookings (id, siteId, eventName, eventTypeId, expectedAttendance, startAt, endAt, status, buildingScope) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, siteId, eventName, eventTypeId, expectedAttendance, startAt, endAt, status, buildingScope, createdAt",
            (booking_id, siteId, eventName, eventTypeId, expectedAttendance, startAt, endAt, status, json.dumps(buildingScope or []))
        )
        result = cur.fetchone()
    
    return {
        "id": result[0],
        "siteId": result[1],
        "eventName": result[2],
        "eventTypeId": result[3],
        "expectedAttendance": result[4],
        "startAt": result[5],
        "endAt": result[6],
        "status": result[7],
        "buildingScope": _ensure_dict(result[8]),
        "createdAt": str(result[9]),
    }


def get_bookings(siteId: str = None) -> list:
    """Get bookings, optionally filtered by siteId."""
    with get_db_cursor() as cur:
        if siteId:
            cur.execute("SELECT id, siteId, eventName, eventTypeId, expectedAttendance, startAt, endAt, status, buildingScope, createdAt FROM bookings WHERE siteId = %s", (siteId,))
        else:
            cur.execute("SELECT id, siteId, eventName, eventTypeId, expectedAttendance, startAt, endAt, status, buildingScope, createdAt FROM bookings")
        rows = cur.fetchall()
    
    return [
        {
            "id": row[0],
            "siteId": row[1],
            "eventName": row[2],
            "eventTypeId": row[3],
            "expectedAttendance": row[4],
            "startAt": row[5],
            "endAt": row[6],
            "status": row[7],
            "buildingScope": _ensure_dict(row[8]),
            "createdAt": str(row[9]),
        }
        for row in rows
    ]


# ============= OCCUPANCY SIGNALS =============

def create_occupancy_signal(roomId: str, currentOccupancy: int, capacity: int = None, source: str = None) -> dict:
    """Create an occupancy signal in database."""
    sig_id = _new_id("occupancy")
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO occupancy_signals (id, roomId, currentOccupancy, capacity, source) VALUES (%s, %s, %s, %s, %s) RETURNING id, roomId, currentOccupancy, capacity, timestamp, source",
            (sig_id, roomId, currentOccupancy, capacity, source)
        )
        result = cur.fetchone()
    
    return {
        "id": result[0],
        "roomId": result[1],
        "currentOccupancy": result[2],
        "capacity": result[3],
        "timestamp": str(result[4]),
        "source": result[5],
    }


def get_occupancy_signals(roomId: str = None) -> list:
    """Get occupancy signals, optionally filtered by roomId."""
    with get_db_cursor() as cur:
        if roomId:
            cur.execute("SELECT id, roomId, currentOccupancy, capacity, timestamp, source FROM occupancy_signals WHERE roomId = %s ORDER BY timestamp DESC", (roomId,))
        else:
            cur.execute("SELECT id, roomId, currentOccupancy, capacity, timestamp, source FROM occupancy_signals ORDER BY timestamp DESC")
        rows = cur.fetchall()
    
    return [
        {
            "id": row[0],
            "roomId": row[1],
            "currentOccupancy": row[2],
            "capacity": row[3],
            "timestamp": str(row[4]),
            "source": row[5],
        }
        for row in rows
    ]
