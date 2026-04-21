#!/usr/bin/env python3
"""
Test harness for PedSim bridge.
Tests:
1. Bridge syntax and startup
2. Mock UDP frame parsing
3. Backend integration (POST and GET)
4. Full end-to-end flow
"""

import socket
import subprocess
import time
import requests
import json
import sys
import threading
from pathlib import Path

# Colors for test output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
RESET = '\033[0m'
BOLD = '\033[1m'

BACKEND_URL = 'http://localhost:8904'
BRIDGE_PORT = 2222


def log_pass(msg):
    print(f"{GREEN}✓{RESET} {msg}")


def log_fail(msg):
    print(f"{RED}✗{RESET} {msg}")


def log_info(msg):
    print(f"{YELLOW}ℹ{RESET} {msg}")


def log_section(title):
    print(f"\n{BOLD}{title}{RESET}")
    print("=" * 70)


def test_bridge_syntax():
    """Test 1: Bridge Python syntax."""
    log_section("TEST 1: Bridge Python Syntax")
    try:
        result = subprocess.run(
            ['python3', '-m', 'py_compile', 'pedsim_bridge.py'],
            cwd='/Users/likhithkanigolla/IIITH/code-files/Digital-Twin/Crowd/backend',
            capture_output=True,
            timeout=5
        )
        if result.returncode == 0:
            log_pass("Bridge syntax is valid")
            return True
        else:
            log_fail(f"Syntax error: {result.stderr.decode()}")
            return False
    except Exception as e:
        log_fail(f"Syntax check failed: {e}")
        return False


def test_backend_pedsim_endpoint():
    """Test 2: Backend /pedsim/state endpoint is reachable."""
    log_section("TEST 2: Backend /pedsim/state Endpoint")
    try:
        # GET empty state
        resp = requests.get(f'{BACKEND_URL}/pedsim/state', timeout=2)
        if resp.status_code == 200:
            log_pass(f"Backend GET /pedsim/state returns 200")
            data = resp.json()
            log_pass(f"Empty state contains {data.get('agent_count', 0)} agents")
        else:
            log_fail(f"Backend returned {resp.status_code}")
            return False
        
        # POST test frame
        test_frame = {
            "sim_time": 9.5,
            "agents": [
                {"agent_id": "test1", "lng": 78.3480, "lat": 17.4450, "cohort_id": "ug1", "state": "MOVING"},
                {"agent_id": "test2", "lng": 78.3490, "lat": 17.4460, "cohort_id": "faculty", "state": "INSIDE"}
            ],
            "metadata": {"source": "test_harness"}
        }
        resp = requests.post(f'{BACKEND_URL}/pedsim/state', json=test_frame, timeout=2)
        if resp.status_code == 200:
            log_pass(f"Backend POST /pedsim/state returns 200")
        else:
            log_fail(f"Backend POST returned {resp.status_code}")
            return False
        
        # Verify data persists
        resp = requests.get(f'{BACKEND_URL}/pedsim/state', timeout=2)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('agent_count') == 2:
                log_pass(f"Backend stored 2 agents, verification passed")
            else:
                log_fail(f"Expected 2 agents, got {data.get('agent_count')}")
                return False
        
        return True
    except Exception as e:
        log_fail(f"Endpoint test failed: {e}")
        return False


def send_mock_pedsim_frame(port: int, frame_data: str):
    """Send a mock PedSim frame to the bridge."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.sendto(frame_data.encode('utf-8'), ('127.0.0.1', port))
        sock.close()
        return True
    except Exception as e:
        log_fail(f"Failed to send UDP frame: {e}")
        return False


def test_bridge_frame_parsing():
    """Test 3: Bridge can parse mock PedSim frames."""
    log_section("TEST 3: Bridge Frame Parsing")
    
    # Mock PedSim frame (XML-like format)
    mock_frame = '''<scenario>
<timestep time="10.25">
<position type="agent" id="agent_001" x="78.3475" y="17.4451" vx="0.1" vy="0.05"/>
<position type="agent" id="agent_002" x="78.3485" y="17.4461" vx="-0.05" vy="0.1"/>
<position type="agent" id="agent_003" x="78.3495" y="17.4471" vx="0.0" vy="0.0"/>
</timestep>
</scenario>'''
    
    try:
        # Import bridge to test parsing directly
        sys.path.insert(0, '/Users/likhithkanigolla/IIITH/code-files/Digital-Twin/Crowd/backend')
        from pedsim_bridge import PedSimBridge
        
        bridge = PedSimBridge()
        agents = bridge._parse_agents(mock_frame)
        
        if len(agents) == 3:
            log_pass(f"Parsed 3 agents from mock frame")
            for agent in agents:
                log_info(f"  - {agent['agent_id']}: lng={agent['lng']}, lat={agent['lat']}")
            return True
        else:
            log_fail(f"Expected 3 agents, parsed {len(agents)}")
            return False
    except Exception as e:
        log_fail(f"Frame parsing test failed: {e}")
        return False


def test_bridge_sim_time_extraction():
    """Test 4: Bridge can extract simulation time."""
    log_section("TEST 4: Simulation Time Extraction")
    
    mock_frame = '''<timestep time="12.75" frame="500">
<position type="agent" id="a1" x="1.0" y="2.0"/>
</timestep>'''
    
    try:
        sys.path.insert(0, '/Users/likhithkanigolla/IIITH/code-files/Digital-Twin/Crowd/backend')
        from pedsim_bridge import PedSimBridge
        
        bridge = PedSimBridge()
        sim_time = bridge._extract_sim_time(mock_frame)
        
        if sim_time == 12.75:
            log_pass(f"Extracted sim_time: {sim_time}")
            return True
        else:
            log_fail(f"Expected sim_time=12.75, got {sim_time}")
            return False
    except Exception as e:
        log_fail(f"Sim time extraction test failed: {e}")
        return False


def test_bridge_backend_integration():
    """Test 5: Bridge can POST to backend."""
    log_section("TEST 5: Bridge → Backend Integration")
    
    try:
        sys.path.insert(0, '/Users/likhithkanigolla/IIITH/code-files/Digital-Twin/Crowd/backend')
        from pedsim_bridge import PedSimBridge
        
        # Clear backend state first
        requests.delete(f'{BACKEND_URL}/pedsim/state', timeout=2)
        log_info("Cleared backend state")
        
        # Create bridge and simulate a POST
        bridge = PedSimBridge(backend_url=BACKEND_URL)
        test_payload = {
            "sim_time": 11.0,
            "timestamp": "2026-04-14T10:00:00Z",
            "agents": [
                {"agent_id": "bridge_test_1", "lng": 78.3480, "lat": 17.4450, "cohort_id": "ug1", "state": "MOVING"}
            ],
            "metadata": {"source": "integration_test"}
        }
        
        # Call internal POST method
        bridge._post_to_backend(test_payload)
        time.sleep(0.5)  # Give backend time to process
        
        # Verify backend received it
        resp = requests.get(f'{BACKEND_URL}/pedsim/state', timeout=2)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('agent_count') == 1:
                agent = data['agents'][0]
                if agent['agent_id'] == 'bridge_test_1':
                    log_pass(f"Bridge successfully POSTed and backend verified the frame")
                    log_info(f"  Agent: {agent['agent_id']} at ({agent['lng']}, {agent['lat']})")
                    return True
        
        log_fail("Backend did not receive the frame from bridge")
        return False
    except Exception as e:
        log_fail(f"Integration test failed: {e}")
        return False


def test_end_to_end_with_live_bridge():
    """Test 6: Full end-to-end with bridge running."""
    log_section("TEST 6: End-to-End (Bridge Running)")
    
    try:
        # Start bridge in a background thread
        sys.path.insert(0, '/Users/likhithkanigolla/IIITH/code-files/Digital-Twin/Crowd/backend')
        from pedsim_bridge import PedSimBridge
        
        # Clear backend
        requests.delete(f'{BACKEND_URL}/pedsim/state', timeout=2)
        log_info("Starting bridge in background...")
        
        bridge = PedSimBridge(listen_port=BRIDGE_PORT, backend_url=BACKEND_URL)
        bridge_thread = threading.Thread(target=bridge.start, daemon=True)
        bridge_thread.start()
        
        time.sleep(1)  # Let bridge start
        log_pass("Bridge started on port 2222")
        
        # Send 3 mock frames to the bridge
        frames = [
            '''<timestep time="8.0">
<position type="agent" id="e2e_001" x="78.3470" y="17.4440"/>
<position type="agent" id="e2e_002" x="78.3480" y="17.4450"/>
</timestep>''',
            '''<timestep time="8.5">
<position type="agent" id="e2e_001" x="78.3472" y="17.4442"/>
<position type="agent" id="e2e_002" x="78.3482" y="17.4452"/>
</timestep>''',
            '''<timestep time="9.0">
<position type="agent" id="e2e_001" x="78.3474" y="17.4444"/>
<position type="agent" id="e2e_002" x="78.3484" y="17.4454"/>
</timestep>'''
        ]
        
        for i, frame in enumerate(frames):
            if send_mock_pedsim_frame(BRIDGE_PORT, frame):
                log_info(f"Sent frame {i+1}/3")
            time.sleep(0.2)
        
        # Give bridge time to process and POST
        time.sleep(2)
        
        # Verify backend received final frame
        resp = requests.get(f'{BACKEND_URL}/pedsim/state', timeout=2)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('sim_time') == 9.0 and data.get('agent_count') == 2:
                log_pass("Backend received final frame from bridge")
                log_info(f"  Sim time: {data['sim_time']}, Agent count: {data['agent_count']}")
                
                # Verify agent details
                agents = data.get('agents', [])
                if len(agents) >= 2:
                    for agent in agents:
                        log_info(f"  - {agent['agent_id']}: ({agent['lng']}, {agent['lat']})")
                
                bridge.stop()
                return True
        
        log_fail("Backend did not receive frame from bridge")
        bridge.stop()
        return False
    except Exception as e:
        log_fail(f"End-to-end test failed: {e}")
        return False


def run_all_tests():
    """Run all tests."""
    print(f"\n{BOLD}{'='*70}")
    print(f"PedSim Bridge Test Suite")
    print(f"{'='*70}{RESET}\n")
    
    results = []
    
    # Test 1: Syntax
    results.append(("Bridge Syntax", test_bridge_syntax()))
    
    # Test 2: Backend endpoint
    results.append(("Backend Endpoint", test_backend_pedsim_endpoint()))
    
    # Test 3: Frame parsing
    results.append(("Frame Parsing", test_bridge_frame_parsing()))
    
    # Test 4: Sim time extraction
    results.append(("Sim Time Extraction", test_bridge_sim_time_extraction()))
    
    # Test 5: Bridge → Backend
    results.append(("Bridge Integration", test_bridge_backend_integration()))
    
    # Test 6: End-to-end
    results.append(("End-to-End Flow", test_end_to_end_with_live_bridge()))
    
    # Summary
    log_section("TEST SUMMARY")
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = f"{GREEN}PASS{RESET}" if result else f"{RED}FAIL{RESET}"
        print(f"  {status} - {name}")
    
    print(f"\n{BOLD}Total: {passed}/{total} tests passed{RESET}")
    
    if passed == total:
        print(f"\n{GREEN}{BOLD}🎉 ALL TESTS PASSED! PedSim bridge is ready.{RESET}\n")
        return True
    else:
        print(f"\n{RED}{BOLD}⚠️  {total - passed} test(s) failed.{RESET}\n")
        return False


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
