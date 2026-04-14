#!/usr/bin/env python3
"""
Mock PedSim Simulator
Generates realistic crowd movement and sends UDP frames to the bridge.
This allows you to test the entire pipeline without installing real PedSim.

Usage:
    python3 mock_pedsim.py
    
    or configure with:
    python3 mock_pedsim.py --num-agents 20 --speed 1.5 --duration 60
"""

import socket
import time
import math
import argparse
import sys
from datetime import datetime
import random

class MockPedSim:
    def __init__(self, 
                 num_agents=10,
                 speed=1.0,
                 duration=None,
                 bridge_host='127.0.0.1',
                 bridge_port=2222):
        
        self.num_agents = num_agents
        self.speed = speed
        self.duration = duration
        self.bridge_host = bridge_host
        self.bridge_port = bridge_port

        # Map bounds (large area for crowd movement)
        self.map_min_x = 78.3400
        self.map_max_x = 78.5600
        self.map_min_y = 17.3600
        self.map_max_y = 17.5600
        
        # Agent data: {id: {'x': float, 'y': float, 'vx': float, 'vy': float}}
        self.agents = {}
        self._init_agents()
        
        # Simulation state
        self.sim_time = 0.0
        self.timestep = 0.1  # 100ms per frame
        self.frame_count = 0
        self.start_time = time.time()
        
    def _init_agents(self):
        """Initialize agents with random positions and velocities."""
        random.seed(42)  # For reproducibility
        for i in range(self.num_agents):
            agent_id = f"agent_{i:03d}"
            self.agents[agent_id] = {
                'x': random.uniform(self.map_min_x, self.map_max_x),
                'y': random.uniform(self.map_min_y, self.map_max_y),
                'vx': random.uniform(-self.speed, self.speed),
                'vy': random.uniform(-self.speed, self.speed),
                'state': random.choice([1, 2, 3]),
                'target_change_timer': 0,
            }
    
    def _update_agents(self):
        """Update agent positions (simple physics)."""
        for agent_id, agent in self.agents.items():
            # Occasionally change direction
            if agent['target_change_timer'] <= 0:
                agent['vx'] = random.uniform(-self.speed, self.speed)
                agent['vy'] = random.uniform(-self.speed, self.speed)
                agent['target_change_timer'] = random.randint(20, 80)
            
            agent['target_change_timer'] -= 1
            
            # Update position
            agent['x'] += agent['vx'] * self.timestep
            agent['y'] += agent['vy'] * self.timestep
            
            # Bounce off walls
            if agent['x'] < self.map_min_x:
                agent['x'] = self.map_min_x
                agent['vx'] = abs(agent['vx'])
            elif agent['x'] > self.map_max_x:
                agent['x'] = self.map_max_x
                agent['vx'] = -abs(agent['vx'])
            
            if agent['y'] < self.map_min_y:
                agent['y'] = self.map_min_y
                agent['vy'] = abs(agent['vy'])
            elif agent['y'] > self.map_max_y:
                agent['y'] = self.map_max_y
                agent['vy'] = -abs(agent['vy'])
            
            # Random state changes
            if random.random() < 0.02:
                agent['state'] = random.choice([1, 2, 3])
    
    def _generate_xml_frame(self):
        """Generate XML frame in PedSim format."""
        xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        xml += '<scenario>\n'
        xml += f'  <timestep time="{self.sim_time:.2f}">\n'
        
        for agent_id, agent in self.agents.items():
            xml += (f'    <position type="agent" '
                   f'id="{agent_id}" '
                   f'x="{agent["x"]:.6f}" '
                   f'y="{agent["y"]:.6f}" '
                   f'state="{agent["state"]}" '
                   f'vx="{agent["vx"]:.4f}" '
                   f'vy="{agent["vy"]:.4f}"/>\n')
        
        xml += '  </timestep>\n'
        xml += '</scenario>'
        return xml
    
    def _send_frame(self, xml_data):
        """Send XML frame to bridge via UDP."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.sendto(xml_data.encode(), (self.bridge_host, self.bridge_port))
            sock.close()
            return True
        except Exception as e:
            print(f"❌ Failed to send frame: {e}", file=sys.stderr)
            return False
    
    def run(self):
        """Run the simulation."""
        print("=" * 70)
        print("Mock PedSim Simulator")
        print("=" * 70)
        print(f"Agents: {self.num_agents}")
        print(f"Speed: {self.speed}")
        print(f"Bridge: UDP {self.bridge_host}:{self.bridge_port}")
        print(f"Timestep: {self.timestep} seconds ({1/self.timestep:.0f} FPS)")
        if self.duration:
            print(f"Duration: {self.duration} seconds")
        else:
            print("Duration: Unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print("Starting simulation...")
        print()
        
        try:
            while True:
                # Check duration
                if self.duration and self.sim_time >= self.duration:
                    print(f"\n✅ Simulation completed after {self.duration}s")
                    break
                
                # Update agents
                self._update_agents()
                
                # Generate and send frame
                xml_frame = self._generate_xml_frame()
                sent = self._send_frame(xml_frame)
                
                # Print progress
                self.frame_count += 1
                if self.frame_count % 10 == 0:  # Print every 10 frames
                    status = "✓" if sent else "✗"
                    print(f"{status} Frame {self.frame_count:04d} | "
                          f"Time: {self.sim_time:7.2f}s | "
                          f"Agents: {self.num_agents} | "
                          f"Pos avg: ({sum(a['x'] for a in self.agents.values())/self.num_agents:.4f}, "
                          f"{sum(a['y'] for a in self.agents.values())/self.num_agents:.4f})")
                
                # Advance time and sleep
                self.sim_time += self.timestep
                time.sleep(self.timestep)
        
        except KeyboardInterrupt:
            print("\n\nSimulation stopped by user")
            print(f"   Total frames sent: {self.frame_count}")
            print(f"   Total simulation time: {self.sim_time:.2f}s")
        
        except Exception as e:
            print(f"\n❌ Error during simulation: {e}", file=sys.stderr)
            sys.exit(1)

def main():
    parser = argparse.ArgumentParser(
        description='Mock PedSim Simulator - sends crowd data to your Digital Twin'
    )
    parser.add_argument('--num-agents', type=int, default=10,
                       help='Number of agents to simulate (default: 10)')
    parser.add_argument('--speed', type=float, default=1.0,
                       help='Agent movement speed (default: 1.0)')
    parser.add_argument('--duration', type=float, default=None,
                       help='Simulation duration in seconds (default: unlimited)')
    parser.add_argument('--bridge-host', type=str, default='127.0.0.1',
                       help='Bridge host address (default: 127.0.0.1)')
    parser.add_argument('--bridge-port', type=int, default=2222,
                       help='Bridge UDP port (default: 2222)')
    
    args = parser.parse_args()
    
    sim = MockPedSim(
        num_agents=args.num_agents,
        speed=args.speed,
        duration=args.duration,
        bridge_host=args.bridge_host,
        bridge_port=args.bridge_port
    )
    
    sim.run()

if __name__ == '__main__':
    main()
