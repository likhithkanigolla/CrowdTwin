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


class PedSimAgentState(BaseModel):
    """Single agent state frame emitted by PedSim"""
    agent_id: str
    lng: float
    lat: float
    cohort_id: Optional[str] = None
    state: str = "MOVING"


class PedSimStateUpdate(BaseModel):
    """Latest PedSim frame pushed from the external PedSim runner"""
    sim_time: Optional[float] = None
    timestamp: Optional[str] = None
    agents: List[PedSimAgentState] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PedSimSceneFromMapRequest(BaseModel):
    """Map geometry payload used to generate a PedSim-compatible scene file."""
    origin_lng: float
    origin_lat: float
    scale: float = 0.00003
    buildings: Dict[str, Any] = Field(default_factory=dict)
    pathways: Dict[str, Any] = Field(default_factory=dict)
    boundary: Optional[Dict[str, Any]] = None
    include_agents: bool = True
    default_agent_count: int = 120


class PedSimRuntimeStartRequest(BaseModel):
    """Runtime launch options for PedSim demoapp + UDP bridge."""
    scene_file: Optional[str] = None
    listen_port: int = 2222
    backend_url: Optional[str] = None
    force_restart: bool = True


class BehaviorRequest(BaseModel):
    """Request to update agent behavior parameters"""
    agent_id: Optional[str] = None
    cohort: Optional[str] = None
    target_speed: Optional[float] = None
    path_preference: Optional[str] = None  # "shortest", "least_crowded", etc.
    patience_level: Optional[float] = None # 0.0 to 1.0
    social_distancing: Optional[bool] = None
    notes: Optional[str] = None


class BehaviorResponse(BaseModel):
    """Response after updating agent behavior"""
    success: bool
    message: str
    updated_agents_count: int
    details: Optional[Dict[str, Any]] = None


# ==================== SUMMARIZATION SCHEMAS ====================

class SummarizationRequest(BaseModel):
    """Request to summarize a simulation run"""
    request_id: str
    metrics: Dict[str, Any]
    output_format: Dict[str, Any] = Field(default_factory=dict)
    events: List[Dict[str, Any]] = Field(default_factory=list)


class SummarizationResponse(BaseModel):
    """Response with simulation run summary"""
    request_id: str
    model: Dict[str, Any]
    status: str
    summary: Dict[str, Any]
    citations: List[Dict[str, Any]] = Field(default_factory=list)


# ==================== ROUTER SCHEMAS ====================

class RouterRequest(BaseModel):
    """Request to route a task to the appropriate handler"""
    request_id: str
    task_type: str
    thresholds: Dict[str, Any] = Field(default_factory=dict)
    constraints: Dict[str, Any] = Field(default_factory=dict)
    fallback_policy: Dict[str, Any] = Field(default_factory=dict)


class RouterResponse(BaseModel):
    """Response from task router with routing decision"""
    request_id: str
    status: str
    selected_path: str
    provider_used: str
    decision: Dict[str, Any]
    quality: Dict[str, Any] = Field(default_factory=dict)
    fallback: Dict[str, Any] = Field(default_factory=dict)
    audit: Dict[str, Any] = Field(default_factory=dict)
