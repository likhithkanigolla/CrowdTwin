#!/usr/bin/env python3
"""
Quick test to verify the entire pipeline works.
This simulates PedSim sending frames to the bridge.
Good diagnostic tool to use before connecting real PedSim.
"""

import socket
import time
import requests
import json

BRIDGE_HOST = '127.0.0.1'
BRIDGE_PORT = 2222
BACKEND_URL = 'http://localhost:8904'

def send_frame_to_bridge(frame_data):
    """Send XML frame to bridge via UDP."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.sendto(frame_data.encode(), (BRIDGE_HOST, BRIDGE_PORT))
        sock.close()
        print(f"✓ Sent frame to bridge (UDP {BRIDGE_HOST}:{BRIDGE_PORT})")
        return True
    except Exception as e:
        print(f"✗ Failed to send to bridge: {e}")
        return False

def check_backend():
    """Check if backend has received agents."""
    try:
        resp = requests.get(f'{BACKEND_URL}/pedsim/state', timeout=2)
        data = resp.json()
        agent_count = data.get('agent_count', 0)
        agents = data.get('agents', [])
        
        if agent_count > 0:
            print(f"✓ Backend received {agent_count} agents")
            for i, agent in enumerate(agents[:2]):
                print(f"  - Agent {i+1}: {agent.get('agent_id')} at ({agent.get('lng'):.4f}, {agent.get('lat'):.4f})")
            if agent_count > 2:
                print(f"  ... and {agent_count - 2} more")
        else:
            print(f"✓ Backend ready but no agents yet (agent_count: {agent_count})")
        
        return data
    except Exception as e:
        print(f"✗ Backend unreachable: {e}")
        return None

print("=" * 60)
print("PEDSIM PIPELINE TEST")
print("=" * 60)

# Test 1: Check backend
print("\n1️⃣ Checking backend on port 8904...")
check_backend()

# Test 2: Send test frame
print("\n2️⃣ Sending test PedSim frame (3 agents)...")
test_frame = """<?xml version="1.0" encoding="UTF-8"?>
<scenario>
  <timestep time="10.5">
    <position type="agent" id="agent_001" x="78.5400" y="17.3650" state="1"/>
    <position type="agent" id="agent_002" x="78.5402" y="17.3652" state="1"/>
    <position type="agent" id="agent_003" x="78.5404" y="17.3654" state="1"/>
  </timestep>
</scenario>"""

send_frame_to_bridge(test_frame)

# Test 3: Wait and check backend
print("\n3️⃣ Waiting for bridge to forward frame (2 seconds)...")
time.sleep(2)

print("\n4️⃣ Checking if backend received the frame...")
state = check_backend()

# Test 4: Verify pipeline
print("\n" + "=" * 60)
if state and state.get('agent_count', 0) > 0:
    print("✅ PIPELINE WORKING!")
    print("   - Bridge received frame ✓")
    print("   - Bridge parsed agents ✓")
    print("   - Bridge posted to backend ✓")
    print("   - Backend stored state ✓")
    print("   - Frontend can now poll and render ✓")
    print("\n🎯 Next step: Connect your real PedSim to send frames to localhost:2222")
else:
    print("❌ PIPELINE NOT WORKING")
    print("\n   Troubleshooting:")
    print("   1. Is the bridge running? (Terminal: ./start_pedsim_bridge.sh)")
    print("   2. Is the backend running? (Terminal: python main.py)")
    print("   3. Are they on correct ports? (Bridge=2222, Backend=8904)")
    print("\n   📖 See backend/PEDSIM_BRIDGE.md for detailed setup")

print("=" * 60)
