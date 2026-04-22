# CrowdTwin Technical Pitch Deck Content

This file gives you technical slide content for an AMD Slingshot presentation.
Use this as speaker-ready material and build your story on top.

## Slide 1 - Title

Title:
CrowdTwin: AI-Powered Campus Digital Twin for Real-Time Crowd Intelligence

Subtitle:
Prototype built for AMD Slingshot 2026

One-liner:
We convert campus mobility data into live decisions using sensing, simulation, and AI.

## Slide 2 - Slingshot Context

Message:
- Slingshot is a national startup idea challenge.
- It pushes students to solve real-world challenges using AI.
- AMD mentorship and workshops accelerated our execution from concept to working prototype.

Positioning line:
CrowdTwin is our response to a critical real-world challenge: safe and efficient crowd movement in high-density campuses.

## Slide 3 - Problem We Are Solving

Pain points today:
- No unified real-time visibility across roads, gates, and buildings.
- Response is reactive after congestion appears.
- Administrators cannot test interventions safely before applying them.
- Crowd stress events impact safety, timetables, and campus operations.

Why now:
- Campuses are becoming sensor-rich but decision-poor.
- AI can transform raw feeds into operational actions.

## Slide 4 - Solution Overview

CrowdTwin provides a closed-loop digital twin with 3 integrated modes:
- Visualize: live occupancy and movement context.
- Actuate: policy controls and AI-guided interventions.
- Simulate: what-if testing before physical action.

Core value:
Observe -> Predict -> Intervene -> Validate.

## Slide 5 - Product Modes (Demo Lens)

Visualize mode:
- Camera-linked nodes and occupancy overlays.
- Building-level insights and movement map context.

Actuate mode:
- Open, Soft Close, Hard Close controls.
- Rule-based + AI recommendations for congestion handling.

Simulate mode:
- Timetable-driven crowd movement.
- Dynamic routing with road-state awareness.

## Slide 6 - System Architecture

Pipeline:
- IoT/Camera/Sensor inputs -> FastAPI backend ingestion.
- State + logic -> actuation rule engine.
- AI layer -> recommendation generation (Gemini/OpenAI + fallback logic).
- Frontend twin -> live map, agents, control panels.
- PedSim bridge -> external simulation state integration through UDP.

Engineering separation:
- Frontend: interaction, rendering, controls.
- Backend: ingestion, policy, AI integration, orchestration.
- Simulation: synthetic + scenario-driven movement validation.

## Slide 7 - Technical Deep Dive (Frontend)

Stack:
- React 18 + Vite.
- MapLibre GL for geospatial rendering.
- Custom crowd and model layers for agents and semantic campus objects.

Capabilities:
- Real-time UI updates from backend state.
- Role-aware panels and operational controls.
- Cohort-level movement rendering for interpretable behavior.

## Slide 8 - Technical Deep Dive (Backend)

Stack:
- FastAPI service-oriented backend.
- Endpoints for ingestion, state serving, and actuation.

Key modules:
- `logic.py`: decision and actuation logic.
- `allocation_engine.py`: resource/decision allocation path.
- `pedsim_bridge.py`: PedSim state intake and translation.
- `models.py` + `schemas.py`: contract consistency.

Reliability design:
- Deterministic fallback when AI providers are unavailable.
- Test files for bridge and pipeline validation.

## Slide 9 - AI Layer and Decision Strategy

AI role:
- Context-aware intervention suggestions.
- Explainable recommendations for admins.

Fallback role:
- Ensures continuity via deterministic rules.
- Maintains predictable behavior in degraded external AI conditions.

Decision strategy:
- Hybrid architecture: AI-assisted, not AI-dependent.

## Slide 10 - Simulation and Validation Strategy

Simulation engine:
- Schedule-informed movement generation.
- A* pathfinding with dynamic road constraints.
- Time multipliers for fast scenario exploration.

Validation plan:
- Sensor-level accuracy checks.
- Simulated vs observed occupancy comparisons.
- Intervention impact analysis (Soft vs Hard Close).
- Scalability stress tests for peak traffic windows.

## Slide 11 - Why This Is Defensible

Technical moat:
- Integrated tri-mode platform, not a single dashboard.
- Closed-loop architecture connecting sensing to intervention.
- Simulation-first safety before real operational changes.

Execution moat:
- Working prototype with runnable backend, frontend, and PedSim bridge.
- Extensible codebase for research and deployment pathways.

## Slide 12 - Demo Script (4-6 minutes)

Demo sequence:
1. Start in Visualize mode and show live occupancy context.
2. Highlight a congestion hotspot.
3. Move to Actuate mode and apply Soft Close.
4. Request AI recommendation and compare with rule fallback.
5. Move to Simulate mode and replay projected movement changes.
6. Conclude with before/after operational effect.

Backup flow if live feed is limited:
- Use uploaded scenario/timetable and synthetic movement to run repeatable demo behavior.

## Slide 13 - Business and Deployment Direction

Near-term deployments:
- University campuses, tech parks, event venues.

Expansion path:
- MQTT streaming.
- Kafka/Redis event backbone.
- Historical analytics and anomaly detection.
- RL-based policy optimization.
- Production authentication and governance.

## Slide 14 - Impact Metrics (Fill Before Final Pitch)

Add your measured numbers in this template:
- Congestion detection latency: <X sec>
- Decision turnaround time: <Y sec>
- Peak congestion reduction in simulated trials: <Z%>
- Crowd redistribution improvement: <A%>
- Manual operator effort reduction: <B%>

Judges love measurable outcomes; keep at least 3 hard metrics on this slide.

## Slide 15 - Closing Ask

Closing message:
CrowdTwin demonstrates how AI + Digital Twins can improve safety and operations in real environments.

Ask:
- Mentorship for production architecture hardening.
- Pilot support for real sensor integration.
- Ecosystem access to scale from campus prototype to city-scale mobility intelligence.

## Optional Appendix Slides

A1 - API and Data Contracts:
- Key endpoints and payload schema snapshots.

A2 - Test and Verification:
- Mention `test_pedsim_bridge.py`, `test_pipeline.py`, and integration test coverage.

A3 - Risk and Mitigation:
- Privacy, data quality, false positives, and fallback safeguards.

---

## One-Minute Technical Summary (If You Need a Fast Version)

CrowdTwin is an AI-assisted digital twin platform for campus crowd operations. It fuses live sensing, simulation, and operational controls into a closed-loop workflow. The frontend provides real-time geospatial visibility and actuation interfaces, while the FastAPI backend handles ingestion, policy logic, and AI recommendation orchestration with deterministic fallback. A simulation layer and PedSim bridge enable scenario testing and predictive planning before real-world interventions. The result is safer, faster, and more data-driven crowd management.
