from pydantic import BaseModel, Field
from typing import Any, List, Optional, TypedDict


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
