from pydantic import BaseModel, Field
from typing import Any, List, Optional, TypedDict, Dict
from enum import Enum


class Building(BaseModel):
    name: str
    capacity: Optional[int] = None
    occupancy: Optional[int] = None


class EventRequest(BaseModel):
    name: str
    attendees: int
    buildings: List[Building]
    sim_time: Optional[float] = None


class Event(BaseModel):
    name: str
    building_name: str
    attendees: int
    time: str


class CongestionWithEventsRequest(BaseModel):
    sim_time: float = 8.0
    events: List[Event] = Field(default_factory=list)


class ActuationRequest(BaseModel):
    sim_time: float = 8.0
    events: List[Event] = Field(default_factory=list)
    objective: str = "minimize_congestion"
    max_actions: int = 3
    approval_mode: str = "manual"


class ActuationState(TypedDict, total=False):
    sim_time: float
    hour: int
    objective: str
    max_actions: int
    approval_mode: str
    events: List[dict]
    category_counts: dict[str, int]
    alerts: List[dict]
    events_applied: int
    needs_actuation: bool
    control_state: dict[str, Any]
    agent_state: dict[str, Any]
    decisions: list[dict]
    decision_source: str
    response: dict[str, Any]


# ==================== NEW SCHEMAS FOR VISUALIZATION/ACTUATION ====================

class UserRole(str, Enum):
    ADMIN = "admin"
    FACULTY = "faculty"
    STUDENT = "student"


class CameraData(BaseModel):
    """Data received from a camera sensor"""
    camera_id: str
    location_name: str
    lat: float
    lng: float
    people_count: int
    direction: Optional[str] = None  # "in", "out", or "bidirectional"
    timestamp: Optional[str] = None


class CameraFeedUpdate(BaseModel):
    """Batch update from multiple cameras"""
    cameras: List[CameraData]
    timestamp: Optional[str] = None


class BuildingOccupancyUpdate(BaseModel):
    """Occupancy data for buildings from sensors"""
    building_name: str
    current_occupancy: int
    capacity: Optional[int] = None
    last_updated: Optional[str] = None


class RoadStatus(str, Enum):
    OPEN = "open"
    SOFT_CLOSED = "soft_closed"  # Can be auto-opened if needed
    HARD_CLOSED = "hard_closed"  # Manually closed, cannot be auto-opened


class RoadControlCommand(BaseModel):
    """Command to control a road segment"""
    road_id: str
    road_name: Optional[str] = None
    status: RoadStatus
    reason: Optional[str] = None
    closed_by: Optional[UserRole] = None


class ClassroomRequirement(BaseModel):
    """Faculty uploads requirements for a classroom"""
    classroom_id: str
    classroom_name: str
    date: str
    start_time: str
    end_time: str
    requirements: Dict[str, Any] = Field(default_factory=dict)
    faculty_id: Optional[str] = None
    notes: Optional[str] = None


class ActuationRule(BaseModel):
    """Rule for automatic actuation"""
    rule_id: str
    name: str
    condition: str  # e.g., "road_crowd > 80%"
    action: str  # e.g., "redirect_traffic"
    priority: int = 5
    enabled: bool = True
    auto_execute: bool = False  # If true, executes without approval


class SimulationScheduleEntry(BaseModel):
    """A single entry in a custom simulation schedule"""
    time: str
    from_location: str
    to_location: str
    cohort: str
    count: int
    notes: Optional[str] = None


class SimulationConfig(BaseModel):
    """Configuration for a simulation experiment"""
    name: str
    schedule: List[SimulationScheduleEntry]
    road_closures: List[RoadControlCommand] = Field(default_factory=list)
    initial_population: int = 0
    actuation_rules_enabled: bool = True
