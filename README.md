# 🏙️ CrowdTwin — Smart Campus Digital Twin (Prototype v1)

<p align="center">
  <b>Real-time Crowd Intelligence Platform powered by IoT Sensors & AI</b><br/>
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

# Setup Guide (Ubuntu, Linux, Windows + PedSim)

This section is for setting up CrowdTwin on a fresh machine.

## 1) Common Prerequisites

- Git
- Node.js 20+ and npm
- Python 3.10+
- CMake 3.16+
- A C/C++ compiler toolchain

Clone the repository:

```bash
git clone <your-repo-url>
cd Crowd
```

## 2) Frontend Setup (All Platforms)

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL: http://localhost:5173

## 3) Backend Setup (All Platforms)

### Linux/macOS shell

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

### Windows PowerShell

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

Backend default URL: http://localhost:8904

## 3.1) Run on a Server / Access From Another PC

If you deploy CrowdTwin on a server and open it from another computer on the same network, use the server IP or hostname instead of `localhost`.

### Backend

The backend already binds to all interfaces by default (`0.0.0.0`), so the server is reachable from your PC as long as the port is open:

```bash
cd backend
HOST=0.0.0.0 PORT=8904 python main.py
```

If you use a reverse proxy or different hostname, update `CORS_ORIGINS` so the browser origin is allowed:

```bash
export CORS_ORIGINS=http://SERVER_IP:5173,http://SERVER_HOSTNAME:5173
```

### Frontend

For remote access, the frontend must point to the server API address, not `localhost`.

```bash
cd frontend
VITE_API_BASE_URL=http://SERVER_IP:8904 npm run dev -- --host 0.0.0.0
```

If you are serving a production build, configure your web server or reverse proxy so `/api` routes go to the backend on port `8904`.

### PedSim Bridge on Server

Run the bridge on the same server and point it to the server backend URL:

```bash
cd backend
PEDSIM_BACKEND_URL=http://SERVER_IP:8904 ./start_pedsim_bridge.sh
```

PedSim itself should still send UDP frames to the bridge on port `2222` (or your custom `PEDSIM_LISTEN_PORT`).

### Ports to Open

- Backend: `8904/tcp`
- Frontend dev server: `5173/tcp` if you use `npm run dev`
- PedSim bridge: `2222/udp`

### Quick Rule

- If the browser is on the same machine as the server and you use Vite dev server, `VITE_API_BASE_URL` can stay default if you use the Vite proxy.
- If the browser is on a different PC, use the server IP/hostname and make sure CORS allows that origin.

## 4) PedSim Setup

PedSim integration path in this project:

- PedSim simulator sends UDP frames on port 2222
- Bridge receives UDP and forwards to backend endpoint /pedsim/state
- Frontend polls backend and renders agents

Detailed bridge docs: backend/PEDSIM_BRIDGE.md

### Ubuntu (22.04/24.04)

Install build dependencies:

```bash
sudo apt update
sudo apt install -y build-essential cmake qtbase5-dev qtchooser qt5-qmake qttools5-dev-tools libgl1-mesa-dev
```

Build PedSim from the repository folder:

```bash
cd pedsim
mkdir -p build
cd build
cmake ..
cmake --build . -j"$(nproc)"
```

Start bridge:

```bash
cd backend
chmod +x start_pedsim_bridge.sh
./start_pedsim_bridge.sh
```

Run simulator (example flags; adapt to your PedSim binary/options):

```bash
cd pedsim/build
./pedsim_simulator --output-format=udp --output-address=127.0.0.1 --output-port=2222 ../scenarios/test_scenario.xml
```

If your build uses different binaries/options, refer to your PedSim executable help and backend/PEDSIM_BRIDGE.md.

### Other Linux Distributions

Use your distro-equivalent packages:

- Fedora: Development Tools, cmake, qt5-qtbase-devel, qt5-qttools-devel, mesa-libGL-devel
- Arch: base-devel, cmake, qt5-base, qt5-tools, mesa
- Debian: similar to Ubuntu package names

Then follow the same build and run sequence as Ubuntu.

### Windows

Recommended approach for PedSim: WSL2 (Ubuntu).

1. Install WSL2 and Ubuntu.
2. Open Ubuntu shell and follow the Ubuntu steps above for backend + PedSim + bridge.
3. Access the UI from Windows browser at http://localhost:5173

Why WSL2: PedSim and UDP bridge workflow are significantly more reliable in Linux userspace than native Windows C++/Qt toolchain setup.

## 5) Run Everything (Reference 4-Terminal Flow)

Terminal 1 (Backend):

```bash
cd backend
python main.py
```

Terminal 2 (Bridge):

```bash
cd backend
./start_pedsim_bridge.sh
```

Terminal 3 (PedSim):

```bash
cd pedsim/build
./pedsim_simulator --output-format=udp --output-address=127.0.0.1 --output-port=2222 ../scenarios/test_scenario.xml
```

Terminal 4 (Frontend):

```bash
cd frontend
npm run dev
```

## 6) Verify PedSim Pipeline

Run backend integration checks:

```bash
cd backend
python test_pedsim_bridge.py
python test_pipeline.py
```

Expected: bridge receives frames, backend updates pedsim state, frontend can render agents in simulate mode.

## 7) Existing Platform Docs

- macOS-specific PedSim guide: backend/PEDSIM_SETUP_MACOS.md
- Bridge details and troubleshooting: backend/PEDSIM_BRIDGE.md
- Quick integration notes: backend/QUICKSTART.md

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

Team: Nexus

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

**September 2026**

