"""
PostgreSQL database module using psycopg2.
Direct SQL queries for sites, buildings, rooms, bookings, and event types.
"""

import psycopg2
from psycopg2 import pool
import os
from contextlib import contextmanager

# Database connection pool
db_host = os.getenv("DB_HOST", "localhost")
db_port = os.getenv("DB_PORT", "5432")
db_user = os.getenv("DB_USER", "postgres")
db_password = os.getenv("DB_PASSWORD", "postgres")
db_name = os.getenv("DB_NAME", "crowdtwin")

connection_pool = pool.SimpleConnectionPool(
    1, 20,
    host=db_host,
    port=db_port,
    user=db_user,
    password=db_password,
    database=db_name
)


@contextmanager
def get_db_connection():
    """Get a connection from the pool."""
    conn = connection_pool.getconn()
    try:
        yield conn
    finally:
        connection_pool.putconn(conn)


@contextmanager
def get_db_cursor():
    """Get a cursor from a pooled connection."""
    with get_db_connection() as conn:
        cur = conn.cursor()
        try:
            yield cur
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cur.close()


def init_db():
    """Create all tables in PostgreSQL."""
    with get_db_connection() as conn:
        cur = conn.cursor()
        
        # Sites table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sites (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                geoBoundary JSONB,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Buildings table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS buildings (
                id VARCHAR(255) PRIMARY KEY,
                siteId VARCHAR(255) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                location JSONB,
                category VARCHAR(100),
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Rooms table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS rooms (
                id VARCHAR(255) PRIMARY KEY,
                buildingId VARCHAR(255) NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                floor VARCHAR(50),
                capacity INTEGER,
                roomType VARCHAR(100),
                status VARCHAR(50) DEFAULT 'available',
                accessibilityScore FLOAT DEFAULT 0.0,
                estimatedCost FLOAT DEFAULT 0.0,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Event types table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS event_types (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                isCustom BOOLEAN DEFAULT FALSE,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Event profiles table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS event_profiles (
                id VARCHAR(255) PRIMARY KEY,
                eventTypeId VARCHAR(255) NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
                configJson JSONB,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Bookings table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS bookings (
                id VARCHAR(255) PRIMARY KEY,
                siteId VARCHAR(255) NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
                eventName VARCHAR(255) NOT NULL,
                eventTypeId VARCHAR(255) NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
                expectedAttendance INTEGER,
                startAt VARCHAR(100) NOT NULL,
                endAt VARCHAR(100) NOT NULL,
                status VARCHAR(50) DEFAULT 'confirmed',
                buildingScope JSONB DEFAULT '[]',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Booking rooms table (many-to-many)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS booking_rooms (
                id VARCHAR(255) PRIMARY KEY,
                bookingId VARCHAR(255) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
                roomId VARCHAR(255) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                allocationType VARCHAR(100),
                allocationScore FLOAT
            )
        """)
        
        # Occupancy signals table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS occupancy_signals (
                id VARCHAR(255) PRIMARY KEY,
                roomId VARCHAR(255) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                currentOccupancy INTEGER,
                capacity INTEGER,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                source VARCHAR(100)
            )
        """)
        
        # Facility types table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS facility_types (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                unit VARCHAR(50),
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Room facilities table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS room_facilities (
                id VARCHAR(255) PRIMARY KEY,
                roomId VARCHAR(255) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                facilityTypeId VARCHAR(255) NOT NULL REFERENCES facility_types(id) ON DELETE CASCADE,
                quantity FLOAT DEFAULT 1.0,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.commit()
        cur.close()


def close_db_pool():
    """Close all connections in the pool."""
    if connection_pool:
        connection_pool.closeall()

