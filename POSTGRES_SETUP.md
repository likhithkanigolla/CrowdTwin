# PostgreSQL Persistence Setup

## What Was Done

Your CrowdTwin backend is now configured to use PostgreSQL instead of in-memory stores. All data persists between server restarts.

### Files Created/Modified:

1. **`backend/models.py`** (NEW)
   - PostgreSQL connection pool management using psycopg2
   - `init_db()` - Creates all database tables on startup
   - `close_db_pool()` - Gracefully closes connections on shutdown

2. **`backend/db_ops.py`** (NEW)
   - Direct SQL operations for all CRUD operations:
     - Sites, Buildings, Rooms
     - Event Types, Event Profiles
     - Bookings, Occupancy Signals
   - Uses psycopg2 connection pool from models.py

3. **`backend/main.py`** (UPDATED)
   - Added database initialization on `startup` event
   - Updated endpoints to use db_ops instead of in-memory stores:
     - POST /sites → `db_ops.create_site()`
     - POST /buildings → `db_ops.create_building()`
     - POST /rooms → `db_ops.create_room()`
     - POST /event-types → `db_ops.create_event_type()`
     - POST /event-profiles → `db_ops.create_event_profile()`
     - POST /bookings → `db_ops.create_booking()`
     - POST /occupancy-signals → `db_ops.create_occupancy_signal()`
     - GET /allocations/catalog → Reads from PostgreSQL

4. **`backend/requirements.txt`** (UPDATED)
   - Added: `psycopg2-binary` (PostgreSQL driver)

## How to Run

### 1. Ensure PostgreSQL is Running

```bash
# Check if PostgreSQL is running
psql -U postgres -c "SELECT 1"

# Should respond with "1"
```

### 2. Create the Database (if not done yet)

```bash
psql -U postgres -c "CREATE DATABASE crowdtwin;"
```

### 3. Start Backend

```bash
cd backend
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=crowdtwin

uvicorn main:app --port 8904 --reload
```

On startup, you'll see:
```
✓ PostgreSQL database initialized
```

### 4. Run the Seeder

```bash
cd backend
python seeders/campus_seed.py --backend http://localhost:8904
```

The seeder will now:
1. POST site, building, room, event-type data to the API
2. Backend stores all data in PostgreSQL via the updated endpoints
3. Frontend config syncs to `frontend/src/data/campusConfig.seed.json`

### 5. Verify Data Persists

Check the `/allocations/catalog` endpoint:

```bash
curl http://localhost:8904/allocations/catalog | jq .
```

Should show all seeded sites, buildings, rooms, bookings in JSON.

### 6. Restart Backend

```bash
# Press Ctrl+C to stop
# Restart:
uvicorn main:app --port 8904 --reload
```

Query `/allocations/catalog` again — all data is still there! ✓

## Environment Variables

Set these before starting the backend (defaults shown):

```bash
DB_HOST=localhost          # PostgreSQL host
DB_PORT=5432              # PostgreSQL port
DB_USER=postgres          # PostgreSQL username
DB_PASSWORD=postgres      # PostgreSQL password
DB_NAME=crowdtwin         # Database name
```

## Database Schema

Tables created automatically on startup:

| Table | Purpose |
|-------|---------|
| sites | Campus/site definitions |
| buildings | Building info per site |
| rooms | Rooms within buildings |
| event_types | Lecture, Lab/Tutorial types |
| event_profiles | Configuration for event types |
| bookings | Event bookings |
| booking_rooms | Room allocations for bookings |
| occupancy_signals | Real-time occupancy readings |
| facility_types | Types of facilities (washroom, exit, etc.) |
| room_facilities | Facilities within each room |

## Next Steps

The Actuation page still uses browser localStorage + seed JSON. To fully integrate it with backend:

1. **Read from DB**: Frontend fetches campus config from `/allocations/catalog`
2. **Write to DB**: Gate/display/rule edits POST back to backend
3. **Live Updates**: WebSocket for real-time occupancy/status

Want me to wire that up?
