# PedSim Installation & Setup for macOS

This guide will help you install PedSim and configure it to send crowd data to your Digital Twin system.

## Prerequisites

**Check if you have these installed:**

```bash
# Check CMake
cmake --version

# Check Qt (if needed)
qmake --version

# Check Homebrew
brew --version
```

If any are missing:
```bash
# Install Homebrew (if needed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install CMake
brew install cmake

# Install Qt (if needed for GUI)
brew install qt
```

## Step 1: Clone PedSim Repository

```bash
# Create a directory for PedSim
mkdir -p ~/projects
cd ~/projects

# Clone the original PedSim repository
git clone https://github.com/srl-ethz/pedsim.git
cd pedsim
```

## Step 2: Build PedSim

```bash
# Create build directory
mkdir build
cd build

# Configure with CMake
cmake ..

# Build
make -j4

# (Optional) Install to system
sudo make install
```

## Step 3: Verify Installation

```bash
# Check if pedsim_simulator exists
ls -la ~/projects/pedsim/build/pedsim_simulator

# Or if installed to system
which pedsim_simulator
```

## Step 4: Create Your Scenario File

Create a test scenario file: `~/projects/pedsim/scenarios/test_scenario.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<scenario>
  <agent id="a0" x="0" y="0" dx="1.0" dy="0.5"/>
  <agent id="a1" x="5" y="0" dx="1.0" dy="0.5"/>
  <agent id="a2" x="10" y="0" dx="1.0" dy="0.5"/>
  <agent id="a3" x="15" y="0" dx="1.0" dy="0.5"/>
  <agent id="a4" x="20" y="0" dx="1.0" dy="0.5"/>
</scenario>
```

## Step 5: Start PedSim with UDP Output

**Option A: Using Built-in UDP Output**

```bash
cd ~/projects/pedsim/build

# Run simulator with UDP output to localhost:2222
./pedsim_simulator \
  --output-format=udp \
  --output-address=127.0.0.1 \
  --output-port=2222 \
  ../scenarios/test_scenario.xml
```

**Option B: If Built-in Not Available, Use 2dvis**

```bash
# Terminal 1: Run the simulator
cd ~/projects/pedsim/build
./pedsim_simulator ../scenarios/test_scenario.xml

# Terminal 2: Run 2dvis with network output to our bridge
./pedsim_2dvis --server localhost:2222
```

**Option C: Run with Simulator in Background**

```bash
# Start simulator in background, keep it running
cd ~/projects/pedsim/build
./pedsim_simulator \
  --output-format=udp \
  --output-address=127.0.0.1 \
  --output-port=2222 \
  ../scenarios/test_scenario.xml &

# Keep process ID handy
PEDSIM_PID=$!
echo "PedSim running with PID: $PEDSIM_PID"
```

## Step 6: Verify Data is Being Sent

**In a new terminal:**

```bash
# Check if data is being sent to 2222
nc -u -l 127.0.0.1 2222

# If successful, you should see XML frames like:
# <?xml version="1.0"?>
# <scenario>
#   <timestep time="1.5">
#     <position type="agent" id="a0" x="0.5" y="0.25"/>
#     <position type="agent" id="a1" x="5.5" y="0.25"/>
#   </timestep>
# </scenario>
```

If you see frames appearing → **Success!** Your PedSim is sending data correctly.

## Step 7: The Full Pipeline

**Now you have everything running:**

```bash
# Terminal 1: Backend
cd /path/to/Crowd/backend
python main.py

# Terminal 2: PedSim Bridge
cd /path/to/Crowd/backend
./start_pedsim_bridge.sh

# Terminal 3: PedSim Simulator
cd ~/projects/pedsim/build
./pedsim_simulator \
  --output-format=udp \
  --output-address=127.0.0.1 \
  --output-port=2222 \
  ../scenarios/test_scenario.xml &

# Terminal 4: Frontend
cd /path/to/Crowd/frontend
npm run dev
```

## Step 8: Verify Everything Works

**In a new terminal:**

```bash
cd /path/to/Crowd/backend
python3 test_pipeline.py
```

You should see:
```
✅ PIPELINE WORKING!
   - Bridge received frame ✓
   - Bridge parsed agents ✓
   - Bridge posted to backend ✓
   - Backend stored state ✓
   - Frontend can now poll and render ✓
```

## Troubleshooting

### "pedsim_simulator: command not found"
```bash
# Either build is not complete, or not in PATH
# Use full path instead:
~/projects/pedsim/build/pedsim_simulator --help
```

### "No frames appearing on nc -u -l"
1. Check PedSim command has `--output-format=udp`
2. Verify port 2222 is correct
3. Check firewall isn't blocking (unlikely for localhost)
4. Try full path to simulator

### "Backend shows agent_count: 0"
1. Verify `nc -u -l 127.0.0.1 2222` shows frames first
2. Check bridge is running: `ps aux | grep pedsim_bridge`
3. Check backend is running: `curl http://localhost:8904/docs`

### Build Errors on macOS
```bash
# If Qt-related:
brew install qt5
# Or for newer versions:
brew install qt@6

# Then rebuild:
cd ~/projects/pedsim/build
cmake .. -DQt5_DIR=$(brew --prefix qt5)/lib/cmake/Qt5
make clean && make -j4
```

## Next Steps

Once this is working:
1. ✅ PedSim sends frames to localhost:2222
2. ✅ Bridge receives and forwards to backend
3. ✅ Frontend polls and receives agent positions
4. ✅ Agents render on map in real-time
5. Create your own scenarios in `scenarios/` folder
6. Adjust simulation parameters as needed

## References

- **PedSim GitHub:** https://github.com/srl-ethz/pedsim
- **PedSim Documentation:** Check `README.md` in the repository
- **Your Bridge Config:** `backend/PEDSIM_BRIDGE.md`

---

**Need help?** Check the console logs in each terminal for error messages.
