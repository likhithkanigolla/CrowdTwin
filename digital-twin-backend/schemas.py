from pydantic import BaseModel, Field, field_validator
from typing import Any, Dict, List, Literal, Optional, TypedDict


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


class Demographics(BaseModel):
    age_bands: Dict[str, float] = Field(default_factory=dict)
    mobility_profile: Dict[str, float] = Field(default_factory=dict)


class Psychology(BaseModel):
    risk_tolerance: float = 0.5
    rule_compliance: float = 0.7
    herding_tendency: float = 0.5
    panic_susceptibility: float = 0.2


class AgentGroup(BaseModel):
    group_id: str
    size: int = 1
    demographics: Demographics = Field(default_factory=Demographics)
    psychology: Psychology = Field(default_factory=Psychology)


class EnvironmentState(BaseModel):
    zone_id: str
    density_per_m2: float = 0.0
    avg_speed_mps: float = 0.0
    visibility_score: float = 1.0
    hazards: List[str] = Field(default_factory=list)
    open_paths: List[str] = Field(default_factory=list)
    blocked_paths: List[str] = Field(default_factory=list)


class CandidateAction(BaseModel):
    action_id: str
    type: str


class BehaviorConstraints(BaseModel):
    must_not_use: List[str] = Field(default_factory=list)
    max_response_ms: int = 900


class BehaviorRequest(BaseModel):
    request_id: str
    timestamp_utc: str
    simulation_id: str
    tick: int
    horizon_seconds: int = 15
    agent_group: AgentGroup
    environment: EnvironmentState
    candidate_actions: List[CandidateAction]
    constraints: BehaviorConstraints = Field(default_factory=BehaviorConstraints)


class ActionProbability(BaseModel):
    action_id: str
    prob: float


class BehaviorModelMeta(BaseModel):
    provider: str
    name: str
    version: str


class DerivedSignals(BaseModel):
    predicted_compliance: float = 0.0
    predicted_panic_rate: float = 0.0
    predicted_herding_rate: float = 0.0


class BehaviorResponse(BaseModel):
    request_id: str
    model: BehaviorModelMeta
    status: Literal["ok", "timeout", "error"]
    latency_ms: int
    confidence: float
    action_probabilities: List[ActionProbability]
    derived_signals: DerivedSignals = Field(default_factory=DerivedSignals)
    rationale_tags: List[str] = Field(default_factory=list)
    safety_flags: List[str] = Field(default_factory=list)
    fallback_recommended: bool = False

    @field_validator("action_probabilities")
    @classmethod
    def _ensure_non_empty_probs(cls, value: List[ActionProbability]) -> List[ActionProbability]:
        if not value:
            raise ValueError("action_probabilities must not be empty")
        return value


class QueueHotspot(BaseModel):
    zone_id: str
    max_queue: int


class RunMetrics(BaseModel):
    peak_density_per_m2: float
    mean_speed_mps: float
    evacuation_time_seconds: float
    queue_hotspots: List[QueueHotspot] = Field(default_factory=list)


class SimulationEvent(BaseModel):
    tick: int
    type: str


class BehaviorSignals(BaseModel):
    avg_herding_rate: float = 0.0
    avg_compliance_rate: float = 0.0
    panic_spike_ticks: List[int] = Field(default_factory=list)


class OutputFormat(BaseModel):
    style: str = "operator_brief"
    max_bullets: int = 6
    include_recommendations: bool = True


class SummaryPeriod(BaseModel):
    start_tick: int
    end_tick: int


class SummarizationRequest(BaseModel):
    request_id: str
    simulation_id: str
    period: SummaryPeriod
    metrics: RunMetrics
    events: List[SimulationEvent] = Field(default_factory=list)
    behavior_signals: BehaviorSignals = Field(default_factory=BehaviorSignals)
    output_format: OutputFormat = Field(default_factory=OutputFormat)


class SummaryModelMeta(BaseModel):
    provider: str
    name: str
    version: str


class Citation(BaseModel):
    source: str
    ref: str


class SummaryBody(BaseModel):
    headline: str
    key_points: List[str] = Field(default_factory=list)
    likely_causes: List[str] = Field(default_factory=list)
    recommended_actions: List[str] = Field(default_factory=list)
    confidence: float = 0.0


class SummarizationResponse(BaseModel):
    request_id: str
    model: SummaryModelMeta
    status: Literal["ok", "partial", "error"]
    summary: SummaryBody
    citations: List[Citation] = Field(default_factory=list)


class Thresholds(BaseModel):
    min_confidence_behavior: float = 0.65
    min_confidence_summary: float = 0.6
    max_schema_errors_per_min: int = 3
    max_timeout_rate_5m: float = 0.1


class FallbackPolicy(BaseModel):
    on_low_confidence: str = "rule_engine"
    on_timeout: str = "rule_engine"
    on_schema_invalid: str = "rule_engine"
    on_provider_down: str = "cached_policy_then_rule_engine"


class RouteConstraints(BaseModel):
    max_latency_ms: int = 900
    must_be_deterministic: bool = False


class RouterRequest(BaseModel):
    request_id: str
    task_type: Literal["behavior_decision", "run_summary"]
    priority: Literal["low", "medium", "high"] = "high"
    payload_ref: str
    constraints: RouteConstraints = Field(default_factory=RouteConstraints)
    thresholds: Thresholds = Field(default_factory=Thresholds)
    fallback_policy: FallbackPolicy = Field(default_factory=FallbackPolicy)


class RouterDecision(BaseModel):
    accepted: bool
    reason: str


class RouterQuality(BaseModel):
    confidence: float
    latency_ms: int
    schema_valid: bool


class RouterFallback(BaseModel):
    triggered: bool
    mode: Optional[str] = None


class RouterAudit(BaseModel):
    trace_id: str
    policy_version: str


class RouterResponse(BaseModel):
    request_id: str
    status: Literal["ok", "error"]
    selected_path: str
    provider_used: str
    decision: RouterDecision
    quality: RouterQuality
    fallback: RouterFallback
    audit: RouterAudit
