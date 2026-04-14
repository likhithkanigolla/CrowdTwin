#!/usr/bin/env python3
"""
PedSim Bridge: Listens to PedSim UDP output and forwards frames to the app backend.

PedSim 2dvis outputs XML-like frames on port 2222 (UDP).
This bridge parses those frames and POSTs them to the backend /pedsim/state endpoint.

Usage:
    python pedsim_bridge.py --listen-port 2222 --backend-url http://localhost:8904
"""

import socket
import argparse
import re
import json
import os
import requests
import time
import threading
import logging
import sys
import errno
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Optional
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)


PEDSIM_SCENE_CENTER_LNG = 78.3487
PEDSIM_SCENE_CENTER_LAT = 17.4464
PEDSIM_SCENE_SCALE = 0.00003
DEFAULT_SCENE_TRANSFORM = {
    "origin_lng": PEDSIM_SCENE_CENTER_LNG,
    "origin_lat": PEDSIM_SCENE_CENTER_LAT,
    "scale": PEDSIM_SCENE_SCALE,
}
SCENE_TRANSFORM_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "pedsim_scene_transform.json")


class PedSimBridge:
    def __init__(self, listen_port: int = 2222, backend_url: str = "http://localhost:8904"):
        self.listen_port = listen_port
        self.backend_url = backend_url
        self.socket = None
        self.running = False
        self.frame_count = 0
        self.error_count = 0
        self.last_post_time = time.time()
        self.last_sim_time: Optional[float] = None
        self.recent_agents: Dict[str, Dict[str, Any]] = {}
        self.recent_agent_seen_at: Dict[str, float] = {}
        self.agent_ttl_seconds = 1.5
        self.scene_transform: Dict[str, Any] = dict(DEFAULT_SCENE_TRANSFORM)
        self.scene_transform_mtime: float = 0.0

    def _refresh_scene_transform(self):
        try:
            stat = os.stat(SCENE_TRANSFORM_PATH)
        except FileNotFoundError:
            return
        except Exception as exc:
            logger.warning(f"Could not stat scene transform file: {exc}")
            return

        if stat.st_mtime <= self.scene_transform_mtime:
            return

        try:
            with open(SCENE_TRANSFORM_PATH, "r", encoding="utf-8") as transform_file:
                payload = json.load(transform_file)
        except Exception as exc:
            logger.warning(f"Could not load scene transform file: {exc}")
            return

        if not isinstance(payload, dict):
            return

        origin_lng = float(payload.get("origin_lng", DEFAULT_SCENE_TRANSFORM["origin_lng"]))
        origin_lat = float(payload.get("origin_lat", DEFAULT_SCENE_TRANSFORM["origin_lat"]))
        scale = float(payload.get("scale", DEFAULT_SCENE_TRANSFORM["scale"])) or DEFAULT_SCENE_TRANSFORM["scale"]
        self.scene_transform = {
            "origin_lng": origin_lng,
            "origin_lat": origin_lat,
            "scale": scale,
            "updated_at": payload.get("updated_at"),
            "boundary_source": payload.get("boundary_source"),
        }
        self.scene_transform_mtime = stat.st_mtime
        logger.info(
            "Loaded PedSim scene transform: "
            f"origin=({origin_lng:.6f}, {origin_lat:.6f}) scale={scale:.8f}"
        )
        
    def start(self) -> bool:
        """Start listening for PedSim frames."""
        self.running = True
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            self.socket.bind(('0.0.0.0', self.listen_port))
        except OSError as e:
            if e.errno == errno.EADDRINUSE:
                logger.error(f"UDP port {self.listen_port} is already in use")
                logger.error("Another PedSim bridge may already be running")
                logger.error(f"Check owner: lsof -nP -iUDP:{self.listen_port}")
                logger.error("Use --listen-port (or PEDSIM_LISTEN_PORT) to choose a different port")
                self.running = False
                self.socket.close()
                self.socket = None
                return False
            raise
        logger.info(f"🔗 PedSim Bridge started, listening on UDP port {self.listen_port}")
        logger.info(f"📍 Backend target: {self.backend_url}/pedsim/state")
        self._refresh_scene_transform()
        
        try:
            while self.running:
                try:
                    data, _ = self.socket.recvfrom(65535)
                    self._process_frame(data)
                except socket.timeout:
                    continue
                except Exception as e:
                    logger.error(f"Error receiving frame: {e}")
                    self.error_count += 1
        except KeyboardInterrupt:
            logger.info("🛑 Bridge interrupted by user")
        finally:
            self.stop()
        
        return True
    
    def stop(self):
        """Stop the bridge."""
        self.running = False
        if self.socket:
            self.socket.close()
            self.socket = None
        logger.info(f"Bridge stopped. Processed {self.frame_count} frames, {self.error_count} errors.")
    
    def _process_frame(self, raw_data: bytes):
        """Parse a PedSim UDP frame and forward to backend."""
        try:
            # Decode the frame
            frame_text = raw_data.decode('utf-8', errors='ignore').strip()
            if not frame_text:
                return
            
            # Parse agents from the frame
            self._refresh_scene_transform()
            agents = self._parse_agents(frame_text)
            
            # Extract sim time from frame if available
            sim_time = self._extract_sim_time(frame_text)

            if sim_time is not None:
                self.last_sim_time = sim_time

            now = time.time()

            # Merge incoming samples into a short rolling crowd cache.
            # This handles streams that send one agent per UDP packet.
            for agent in agents:
                agent_id = str(agent.get("agent_id", ""))
                if not agent_id:
                    continue
                self.recent_agents[agent_id] = agent
                self.recent_agent_seen_at[agent_id] = now

            # Expire stale agents from the cache.
            stale_ids = [
                agent_id
                for agent_id, seen_at in self.recent_agent_seen_at.items()
                if now - seen_at > self.agent_ttl_seconds
            ]
            for agent_id in stale_ids:
                self.recent_agent_seen_at.pop(agent_id, None)
                self.recent_agents.pop(agent_id, None)

            merged_agents = list(self.recent_agents.values())
            
            # Build payload
            payload = {
                "sim_time": self.last_sim_time,
                "timestamp": datetime.now().isoformat(),
                "agents": merged_agents,
                "metadata": {
                    "source": "pedsim_bridge",
                    "frame_number": self.frame_count,
                    "packet_agents": len(agents),
                    "merged_agents": len(merged_agents),
                    "scene_transform": self.scene_transform,
                }
            }
            
            # Only POST if we have agents or significant time has passed
            if merged_agents or (now - self.last_post_time > 1.0):
                self._post_to_backend(payload)
                self.last_post_time = now
                self.frame_count += 1
                
                if self.frame_count % 50 == 0:
                    logger.info(
                        f"✓ Processed {self.frame_count} packets, "
                        f"packet_agents={len(agents)}, merged_agents={len(merged_agents)}"
                    )
        
        except Exception as e:
            logger.error(f"Frame processing error: {e}")
            self.error_count += 1
    
    def _parse_agents(self, frame_text: str) -> List[Dict[str, Any]]:
        """Extract agent positions from PedSim frame text.

        Supports arbitrary XML attribute ordering by parsing XML first,
        and falls back to regex parsing for malformed payloads.
        """
        agents = []

        def _to_geo(x_local: float, y_local: float) -> tuple[float, float]:
            """Map PedSim local XY coordinates into map lon/lat frame."""
            origin_lng = float(self.scene_transform.get("origin_lng", DEFAULT_SCENE_TRANSFORM["origin_lng"]))
            origin_lat = float(self.scene_transform.get("origin_lat", DEFAULT_SCENE_TRANSFORM["origin_lat"]))
            scale = float(self.scene_transform.get("scale", DEFAULT_SCENE_TRANSFORM["scale"])) or DEFAULT_SCENE_TRANSFORM["scale"]
            lng = origin_lng + (x_local * scale)
            lat = origin_lat - (y_local * scale)
            return lng, lat

        def _is_likely_geo(lng: float, lat: float) -> bool:
            return 60.0 <= lng <= 100.0 and 0.0 <= lat <= 40.0

        def _build_agent(agent_id: str, x_value: str, y_value: str) -> Optional[Dict[str, Any]]:
            try:
                x = float(x_value)
                y = float(y_value)
            except (TypeError, ValueError):
                return None

            lng = x
            lat = y
            if not _is_likely_geo(lng, lat):
                lng, lat = _to_geo(x, y)

            return {
                "agent_id": str(agent_id),
                "lng": float(lng),
                "lat": float(lat),
                "cohort_id": "pedsim",
                "state": "MOVING",
                "raw_x": x,
                "raw_y": y,
            }

        # Preferred path: strict XML parsing handles arbitrary attribute ordering.
        try:
            root = ET.fromstring(frame_text)
            for node in root.findall('.//position'):
                if str(node.attrib.get('type', '')).lower() != 'agent':
                    continue
                agent = _build_agent(
                    str(node.attrib.get('id', 'unknown')),
                    node.attrib.get('x', ''),
                    node.attrib.get('y', ''),
                )
                if agent is not None:
                    agents.append(agent)

            if agents:
                return agents
        except ET.ParseError:
            pass

        # Fallback for malformed/truncated payloads: regex with independent attribute capture.
        position_tags = re.findall(r'<position\b[^>]*>', frame_text)
        for tag in position_tags:
            type_match = re.search(r'\btype=["\']([^"\']+)["\']', tag)
            if not type_match or type_match.group(1).lower() != 'agent':
                continue

            id_match = re.search(r'\bid=["\']([^"\']+)["\']', tag)
            x_match = re.search(r'\bx=["\']([^"\']+)["\']', tag)
            y_match = re.search(r'\by=["\']([^"\']+)["\']', tag)
            if not (id_match and x_match and y_match):
                continue

            agent = _build_agent(id_match.group(1), x_match.group(1), y_match.group(1))
            if agent is not None:
                agents.append(agent)
        
        return agents
    
    def _extract_sim_time(self, frame_text: str) -> Optional[float]:
        """Try to extract simulation time from frame."""
        # Pattern: <timestep ... time="123.45" .../>
        time_pattern = r'<timestep[^>]*time=["\']([^"\']+)["\']'
        match = re.search(time_pattern, frame_text)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                return None
        return None
    
    def _post_to_backend(self, payload: Dict[str, Any]):
        """POST frame to backend."""
        try:
            url = f"{self.backend_url}/pedsim/state"
            response = requests.post(
                url,
                json=payload,
                timeout=2.0
            )
            if response.status_code == 200:
                # Success, silently continue
                pass
            else:
                logger.warning(f"Backend returned {response.status_code}: {response.text[:100]}")
        except requests.exceptions.ConnectionError:
            logger.error(f"Cannot connect to backend at {self.backend_url}")
        except Exception as e:
            logger.error(f"POST error: {e}")


def main():
    parser = argparse.ArgumentParser(
        description='PedSim Bridge: Forward PedSim UDP frames to the Digital Twin backend'
    )
    parser.add_argument('--listen-port', type=int, default=2222, help='UDP port to listen on (default: 2222)')
    parser.add_argument('--backend-url', type=str, default='http://localhost:8904', help='Backend URL (default: http://localhost:8904)')
    
    args = parser.parse_args()
    
    bridge = PedSimBridge(listen_port=args.listen_port, backend_url=args.backend_url)
    success = bridge.start()
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
