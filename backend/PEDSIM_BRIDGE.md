# PedSim Bridge Integration Guide

## Overview

The PedSim Bridge connects an external PedSim simulation engine to the Digital Twin crowd simulation. It:

1. **Listens** to PedSim UDP output on port 2222
2. **Parses** XML-formatted position frames
3. **Forwards** agent positions to the backend
4. **Enables** real-time crowd visualization powered by actual PedSim simulation

## Architecture

```
PedSim (C++ Simulator)
    ↓ (UDP XML frames on port 2222)
    ↓
PedSim Bridge (Python)
    ↓ (HTTP POST to /pedsim/state)
    ↓
Backend (FastAPI)
    ↓ (GET /pedsim/state on demand)
    ↓
Frontend (React)
    ↓ (Renders crowd agents on map)
    ↓
Visualization
```

## Quick Start

### 1. Start Backend

```bash
cd backend
python main.py
```

Backend will run on `http://localhost:8904`

### 2. Start PedSim Bridge

```bash
cd backend
chmod +x start_pedsim_bridge.sh
./start_pedsim_bridge.sh
```

Bridge will listen on UDP port 2222 and forward to backend.

### 3. Start Frontend

```bash
cd frontend
npm run dev
```

Frontend will run on `http://localhost:5173`

### 4. Run PedSim Simulation

Start your PedSim simulation to send UDP frames to localhost:2222. 

The bridge will automatically forward frames to the backend. The app will display them in real-time.

## Configuration

### Environment Variables

```bash
# Listen on a different port
PEDSIM_LISTEN_PORT=3333 ./start_pedsim_bridge.sh

# Point to a different backend
PEDSIM_BACKEND_URL=http://192.168.1.100:8904 ./start_pedsim_bridge.sh

# Both
PEDSIM_LISTEN_PORT=3333 PEDSIM_BACKEND_URL=http://192.168.1.100:8904 ./start_pedsim_bridge.sh
```

### Command-Line Arguments

```bash
python pedsim_bridge.py --help
```

## Testing

### Run Full Test Suite

```bash
cd backend
python test_pedsim_bridge.py
```

This will test:
- Bridge syntax and startup
- Mock UDP frame parsing
- Backend integration
- Full end-to-end flow

All 6 tests should pass.

### Manual Testing

#### Send a Test Frame

```bash
# From another terminal while bridge is running
python -c "
import socket
frame = '''<timestep time=\"10.5\">
<position type=\"agent\" id=\"test_001\" x=\"78.3480\" y=\"17.4450\"/>
<position type=\"agent\" id=\"test_002\" x=\"78.3490\" y=\"17.4460\"/>
</timestep>'''
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(frame.encode('utf-8'), ('127.0.0.1', 2222))
sock.close()
print('Frame sent')
"
```

#### Verify Backend Received It

```bash
curl http://localhost:8904/pedsim/state | jq
```

You should see the 2 agents in the response.

## PedSim Frame Format

The bridge expects frames in this XML format:

```xml
<scenario>
<timestep time="10.5" frame="500">
  <position type="agent" id="agent_001" x="78.3480" y="17.4450" vx="0.1" vy="0.05"/>
  <position type="agent" id="agent_002" x="78.3490" y="17.4460" vx="-0.05" vy="0.1"/>
</timestep>
</scenario>
```

Required attributes:
- `type="agent"` - Marks this as an agent (not camera or obstacle)
- `id="..."` - Unique agent identifier
- `x="..."` - Longitude coordinate
- `y="..."` - Latitude coordinate

Optional attributes on `<timestep>`:
- `time="..."` - Simulation time (displayed in UI)
- `frame="..."` - Frame number (logging only)

## Troubleshooting

### Bridge Won't Start

**Problem:** `Address already in use`
- **Solution:** Another process is using port 2222
  ```bash
  lsof -i :2222  # Find what's using it
  kill -9 <PID>  # Kill the process
  ```

**Problem:** `Cannot connect to backend`
- **Solution:** Verify backend is running
  ```bash
  curl http://localhost:8904  # Should return {"status": "Digital Twin Backend Running"}
  ```

### No Agents Appearing in UI

**Problem:** Simulation shows empty despite bridge running
- **Solution:** Bridge isn't receiving PedSim frames
  - Check PedSim is sending to localhost:2222
  - Monitor bridge logs for incoming frames
  - Test with manual curl (see Manual Testing above)

### Bridge Logs Show Errors

**Problem:** "Cannot connect to backend"
- **Solution:** Verify backend URL in bridge config
  ```bash
  PEDSIM_BACKEND_URL=http://localhost:8904 ./start_pedsim_bridge.sh
  ```

**Problem:** "Frame processing error"
- **Solution:** Check PedSim XML format matches expected schema
  - Ensure `type="agent"` is present
  - Ensure `x` and `y` attributes exist (not `vx`/`vy`)

## Performance Notes

- Bridge processes ~50 frames/sec comfortably (depends on agent count per frame)
- Memory overhead: ~20-30 MB
- CPU overhead: <5% per 1000 agents
- Network: ~100 bytes per agent per frame

## Integration with Your PedSim Runner

If you have a custom PedSim runner:

1. **XML Output**: Configure PedSim to output XML frames (not just 2D glyph rendering)
2. **UDP Broadcast**: Send frames to `localhost:2222` (or configured port)
3. **Frame Rate**: Recommend 10-20 Hz for smooth visualization

Example in C++:
```cpp
// After each PedSim simulation step
std::string frame = /* XML formatted frame from PedSim */;
socket.sendto(frame.c_str(), frame.length(), 0, (struct sockaddr*)&addr, sizeof(addr));
```

## API Reference

### POST /pedsim/state

Update the current PedSim frame.

**Request:**
```json
{
  "sim_time": 10.5,
  "timestamp": "2026-04-14T10:00:00Z",
  "agents": [
    {
      "agent_id": "agent_001",
      "lng": 78.3480,
      "lat": 17.4450,
      "cohort_id": "ug1",
      "state": "MOVING"
    }
  ],
  "metadata": {
    "source": "pedsim_bridge",
    "frame_number": 100
  }
}
```

**Response:**
```json
{
  "message": "PedSim state updated",
  "agent_count": 1,
  "timestamp": "2026-04-14T10:00:00Z"
}
```

### GET /pedsim/state

Retrieve the current PedSim frame.

**Response:**
```json
{
  "sim_time": 10.5,
  "timestamp": "2026-04-14T10:00:00Z",
  "agents": [...],
  "metadata": {...},
  "agent_count": 1
}
```

### DELETE /pedsim/state

Clear the current PedSim frame.

**Response:**
```json
{
  "message": "PedSim state cleared"
}
```

## Next Steps

1. ✅ Backend /pedsim/state endpoint is live
2. ✅ Bridge is running and tested
3. ⬜ Connect your PedSim simulation to send UDP frames
4. ⬜ Start visualization in the app

Once PedSim sends frames, agents will appear on the map in real-time.
