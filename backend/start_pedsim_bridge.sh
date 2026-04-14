#!/bin/bash
# start_pedsim_bridge.sh
# Starts the PedSim bridge to forward frames to the backend

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LISTEN_PORT="${PEDSIM_LISTEN_PORT:-2222}"
BACKEND_URL="${PEDSIM_BACKEND_URL:-http://localhost:8904}"

EXISTING_PID="$(lsof -nP -t -iUDP:"$LISTEN_PORT" 2>/dev/null | awk 'NR==1 {print; exit}')"
if [[ -n "$EXISTING_PID" ]]; then
    EXISTING_CMD="$(ps -p "$EXISTING_PID" -o command= 2>/dev/null || true)"
    echo "⚠️  UDP port $LISTEN_PORT is already in use."
    if [[ "$EXISTING_CMD" == *"pedsim_bridge.py"* ]]; then
        echo "ℹ️  PedSim bridge is already running (PID: $EXISTING_PID)."
        echo "    Stop it first if you want to restart: kill $EXISTING_PID"
        exit 0
    fi
    if [[ -n "$EXISTING_CMD" ]]; then
        echo "    PID $EXISTING_PID: $EXISTING_CMD"
    else
        echo "    PID $EXISTING_PID"
    fi
    echo ""
    echo "Start on a different port and try again:"
    echo "  PEDSIM_LISTEN_PORT=<free_port> PEDSIM_BACKEND_URL=$BACKEND_URL ./start_pedsim_bridge.sh"
    exit 1
fi

echo "╔════════════════════════════════════════════╗"
echo "║       PedSim Bridge Startup                ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "🔗 Bridge Configuration:"
echo "   Listen Port: $LISTEN_PORT (UDP)"
echo "   Backend URL: $BACKEND_URL"
echo ""
echo "Usage:"
echo "  PEDSIM_LISTEN_PORT=2222 PEDSIM_BACKEND_URL=http://localhost:8904 ./start_pedsim_bridge.sh"
echo ""
echo "Environment variables:"
echo "  PEDSIM_LISTEN_PORT      - UDP port to listen on (default: 2222)"
echo "  PEDSIM_BACKEND_URL      - Backend URL (default: http://localhost:8904)"
echo ""
echo "Starting bridge..."
echo "════════════════════════════════════════════"
echo ""

cd "$SCRIPT_DIR"
python3 pedsim_bridge.py --listen-port "$LISTEN_PORT" --backend-url "$BACKEND_URL"
