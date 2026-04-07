# 🏙️ CrowdTwin — Smart Campus Digital Twin (Prototype v1)

<p align="center">
  <b>Real-time Crowd Intelligence Platform powered by IoT Sensors & AI</b><br/>
  <i>Built for AMD Slingshot Hackathon 2026</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Prototype-orange" />
  <img src="https://img.shields.io/badge/Version-v1.0-blue" />
  <img src="https://img.shields.io/badge/Last_Updated-01_March_2026-green" />
  <img src="https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/MapLibre_GL-4.x-1E90FF?logo=maplibre&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-0.110+-009688?logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/AI-Gemini_/_OpenAI-FF6F00?logo=google&logoColor=white" />
</p>



---

> ⚠️ **CrowdTwin is currently a working prototype (v1).**
> This version demonstrates core Digital Twin capabilities for smart campus crowd intelligence.
> The system is actively being extended toward real-world deployment, scalability, and research-grade validation.

---

# 🎯 Problem Statement

Managing crowd flow on a university campus is a **critical safety and operational challenge**.

During peak hours, events, or emergencies, administrators typically lack:

* Real-time visibility into crowd density
* Predictive congestion intelligence
* Safe testing environments for interventions
* AI-assisted decision support

**CrowdTwin** creates a **living digital replica of a campus**, powered by IoT sensor streams and AI reasoning, enabling:

* Real-time monitoring
* Proactive actuation
* What-if simulation
* Data-driven crowd intelligence

---

# 🚀 What CrowdTwin Currently Does (Prototype Scope)

CrowdTwin operates in **three integrated modes**:

| Mode         | Purpose             | Current Capabilities                           |
| ------------ | ------------------- | ---------------------------------------------- |
| 📊 Visualize | Live Monitoring     | Camera feeds, occupancy heatmaps, 3D campus    |
| ⚡ Actuate    | Operational Control | Road closures, event rules, AI suggestions     |
| 🔬 Simulate  | What-if Analysis    | Schedule-based movement, congestion prediction |

---

# 🧠 Implemented Core Features

## 🔭 Real-Time Visualization

* Live camera-based people counting
* Geo-tagged camera nodes
* Building-level occupancy analytics
* 3D semantic campus rendering (Hostels, Academics, Canteens, Admin, Gates)
* Agent-based crowd rendering (UG1–UG4, Faculty, Staff)
* Road-aware movement visualization

---

## ⚡ Smart Actuation

* Role-based access (Admin / Faculty / Student)
* Road control statuses:

  * Open
  * Soft Close (temporary restriction)
  * Hard Close (full restriction)
* Classroom IoT setup panel
* Threshold-based automated actuation rules
* AI-powered recommendations (Gemini / OpenAI)
* Deterministic fallback engine

---

## 🔬 Simulation Engine

* Schedule-driven crowd simulation
* A* pathfinding with dynamic road states
* Time control (1x / 5x / 15x)
* CSV-based timetable import
* Congestion impact evaluation
* Cohort-level movement modeling

---

# 🏗️ Architecture (Prototype)

## Frontend

* React 18
* Vite 5
* MapLibre GL JS
* Custom CrowdSimulator (Agent Engine)
* GLTF 3D model rendering

## Backend

* FastAPI (Python)
* REST-based IoT ingestion
* AI Suggestion Layer (Gemini / GPT)
* Rule-based actuation engine
* Synthetic data generator

---

# 🌐 IoT Sensor Architecture (Prototype Assumption)

```
CAMPUS IoT LAYER
    │
    ├── Camera Nodes (Entrances / Roads)
    ├── Building Occupancy Sensors
    ├── Road Segment Monitors
    │
    ▼
FastAPI Backend (Ingestion Layer)
    │
    ▼
AI Engine (Gemini / GPT + Fallback)
    │
    ▼
3D Digital Twin (Frontend)
```

---

# ⚠️ Current Limitations (Prototype Gaps)

## 1️⃣ Real IoT Deployment

* Currently tested using synthetic or manual POST data
* No MQTT streaming integration
* No real camera firmware integration yet

## 2️⃣ Scalability

* Single backend instance
* No distributed streaming (Kafka / Redis not integrated)
* Simulation engine runs client-side

## 3️⃣ AI Capabilities

* No reinforcement learning
* No historical policy learning
* No adaptive long-term optimization

## 4️⃣ Persistence & Analytics

* Limited historical storage
* No long-term congestion analytics dashboard
* No anomaly detection module

## 5️⃣ Security

* Basic role separation
* No production-grade OAuth / SSO
* No secure IoT authentication layer

---

# 🌱 Post-Hackathon Roadmap

* MQTT-based real-time streaming
* Redis / Kafka event pipeline
* Distributed simulation support
* Reinforcement learning congestion optimizer
* Historical analytics dashboard
* Emergency evacuation modeling
* Edge deployment on camera nodes
* Mobile notification system
* Production-grade authentication

---

# 🏙️ Real-World Validation Plan — Smart City Living Lab, IIITH

The CrowdTwin prototype will be **tested and validated** within the **Smart City Living Lab at IIIT Hyderabad (IIITH)**.

The Smart City Living Lab is a real-world experimentation platform consisting of:

* 300+ IoT sensors deployed across campus
* Smart Rooms with environmental monitoring
* Water utility monitoring systems
* Energy monitoring infrastructure
* Wi-SUN mesh network deployments
* Crowd and mobility monitoring systems
* BACnet-based HVAC integration
* oneM2M (Mobius) middleware infrastructure
* Multi-vertical smart infrastructure

The Living Lab acts as a **micro-scale smart city environment**, enabling real deployment validation.

---

## 🔬 Validation Phases

### 1️⃣ Sensor-Level Validation

* Real camera node integration
* Live building occupancy validation
* Latency measurement (sensor → backend → twin)

### 2️⃣ Digital Twin Accuracy

* Compare simulated vs real occupancy
* Validate congestion prediction accuracy
* Measure alert precision

### 3️⃣ Actuation Experiments

* Controlled road restriction experiments
* Evaluate Soft Close vs Hard Close impact
* Measure flow efficiency improvement

### 4️⃣ AI Evaluation

* Compare AI decisions vs expert decisions
* Measure congestion reduction time
* Evaluate response time improvements

### 5️⃣ Scalability Testing

* High-density crowd scenarios
* Multi-building congestion
* Stress testing under peak load

---

## 🔁 Closed-Loop Digital Twin Model

```
Physical Campus
    │
    ▼
IoT Sensors
    │
    ▼
IoT Middleware (oneM2M / Mobius)
    │
    ▼
CrowdTwin Backend + AI Engine
    │
    ▼
3D Digital Twin + Simulation
    │
    ▼
Intervention & Feedback
    │
    └── Model Refinement
```

This establishes a **closed-loop adaptive digital twin system**:

> Physical System → Digital Representation → AI Decision → Physical Intervention → Feedback → Model Update

---

# 🏆 Why CrowdTwin Matters

| Traditional Approach       | CrowdTwin Approach          |
| -------------------------- | --------------------------- |
| Manual headcounts          | Real-time IoT tracking      |
| Reactive response          | Predictive AI modeling      |
| Static signage             | Dynamic road actuation      |
| Experience-based decisions | AI-assisted planning        |
| No sandbox testing         | Simulation-first validation |

---

# 🛠️ Tech Stack

| Layer         | Technology             |
| ------------- | ---------------------- |
| Frontend      | React 18, Vite 5       |
| 3D Engine     | MapLibre GL JS         |
| Simulation    | Custom JS Agent Engine |
| Backend       | FastAPI                |
| AI            | Gemini / OpenAI        |
| Data          | GeoJSON, CSV           |
| IoT Interface | REST (Prototype)       |

---

# 👥 Team

**AMD Slingshot Hackathon 2026**
Team: Nexus for AMD

Contributors:

* Likhith Kanigolla
* Lokabhiram Chintada

---

# 🔬 Research Direction

CrowdTwin is evolving toward a **scalable Smart Campus Digital Twin Platform** combining:

* IoT sensor networks
* Agent-based simulation
* AI-driven actuation
* Real-world validation
* Closed-loop optimization

The current prototype establishes the architectural foundation for this long-term research and deployment vision.

---

# 📅 Last Updated

**March 1, 2026**

