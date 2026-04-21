#!/usr/bin/env python3
"""
campus_seed.py – IIIT Hyderabad Campus Seeder
==============================================
Creates buildings, floors, rooms and seeds the Spring 2026 lecture/lab
timetable into the CrowdTwin backend allocation engine.

It calls the backend REST API so the data lands in all in-memory stores
exactly as if a user had entered it through the UI.

Usage:
    python campus_seed.py                          # default backend
    python campus_seed.py --backend http://localhost:8904
    python campus_seed.py --reset                  # force-reset stores first
    python campus_seed.py --dry-run                # print payloads, don't POST
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, date
from typing import Any, Dict, List, Optional

DEFAULT_BACKEND = "http://localhost:8904"

# ---------------------------------------------------------------------------
# Helper: thin HTTP client (stdlib only)
# ---------------------------------------------------------------------------

def _post(url: str, payload: Dict[str, Any], dry_run: bool = False) -> Dict[str, Any]:
    if dry_run:
        print(f"DRY-RUN POST {url}")
        print(json.dumps(payload, indent=2)[:400])
        return {"id": "dry-run-id"}

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw: bytes = resp.read()
            return json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as exc:
        raw_err: bytes = exc.read()
        print(f"  HTTP {exc.code} on POST {url}: {raw_err.decode()[:300]}")
        raise


# ---------------------------------------------------------------------------
# Campus catalogue
# ---------------------------------------------------------------------------

# Each entry: (building_key, display_name, lat, lng, category, floors_spec)
# floors_spec: list of (floor_label, rooms)
# rooms: list of (room_name, capacity, room_type)

CAMPUS_BUILDINGS = [
    {
        "key": "himalaya",
        "name": "Himalaya",
        "lat": 17.44544,
        "lng": 78.34913,
        "category": "classroom",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("H101", 120, "lecture"),
                    ("H102", 100, "lecture"),
                    ("H103", 90,  "lecture"),
                    ("H104", 80,  "lecture"),
                    ("H105", 70,  "lecture"),
                ],
            },
            {
                "label": "First Floor",
                "rooms": [
                    ("H201", 100, "lecture"),
                    ("H202", 90,  "lecture"),
                    ("H203", 100, "lecture"),
                    ("H204", 80,  "lecture"),
                    ("H205", 70,  "lecture"),
                ],
            },
            {
                "label": "Second Floor",
                "rooms": [
                    ("H301", 80,  "lecture"),
                    ("H302", 70,  "lecture"),
                ],
            },
        ],
    },
    {
        "key": "himalaya_sh",
        "name": "Himalaya (SH Halls)",
        "lat": 17.44548,
        "lng": 78.34918,
        "category": "classroom",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("SH1", 250, "auditorium"),
                    ("SH2", 200, "auditorium"),
                    ("SH3", 180, "auditorium"),
                ],
            },
        ],
    },
    {
        "key": "new_academic_labs",
        "name": "New Academic Block (N-Block)",
        "lat": 17.44520,
        "lng": 78.34900,
        "category": "lab",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("N-104",  60, "lab"),
                    ("N-114",  50, "lab"),
                    ("N-125",  50, "lab"),
                ],
            },
        ],
    },
    {
        "key": "tutorial_labs",
        "name": "Tutorial Labs Block",
        "lat": 17.44535,
        "lng": 78.34905,
        "category": "lab",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("TL1", 40, "tutorial"),
                    ("TL2", 40, "tutorial"),
                    ("TL3", 40, "tutorial"),
                ],
            },
        ],
    },
    {
        "key": "b_block",
        "name": "B-Block",
        "lat": 17.44510,
        "lng": 78.34870,
        "category": "lab",
        "floors": [
            {
                "label": "Basement",
                "rooms": [
                    ("B4-304", 60, "tutorial"),
                    ("B4-302", 50, "tutorial"),
                    ("B6-309", 60, "lab"),
                ],
            },
        ],
    },
    {
        "key": "cr_block",
        "name": "CR Block",
        "lat": 17.44510,
        "lng": 78.34880,
        "category": "classroom",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("CR1", 80, "lecture"),
                ],
            },
        ],
    },
    {
        "key": "a3_block",
        "name": "A3 Block (Science Labs)",
        "lat": 17.44505,
        "lng": 78.34860,
        "category": "lab",
        "floors": [
            {
                "label": "Third Floor",
                "rooms": [
                    ("A3-301", 45, "lab"),
                ],
            },
        ],
    },
    {
        "key": "t_hub",
        "name": "T-Hub",
        "lat": 17.44568,
        "lng": 78.34882,
        "category": "research",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("TH-Open-Lab", 80,  "lab"),
                    ("TH-Meeting",  30,  "conference"),
                ],
            },
            {
                "label": "First Floor",
                "rooms": [
                    ("TH-Research-1", 40, "lab"),
                    ("TH-Research-2", 40, "lab"),
                ],
            },
        ],
    },
    {
        "key": "academic_office",
        "name": "Academic Office",
        "lat": 17.44495,
        "lng": 78.34989,
        "category": "research",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [
                    ("AO-Lab-1",  50, "lab"),
                    ("AO-Lab-2",  50, "lab"),
                    ("AO-Office", 30, "office"),
                ],
            },
        ],
    },
    {
        "key": "new_boys_hostel",
        "name": "New Boys Hostel (NBH)",
        "lat": 17.44716,
        "lng": 78.34760,
        "category": "hostel",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"NBH-{i}{j:02d}", 2, "bedroom") for j in range(1, 21)]}
            for i in range(1, 5)
        ],
    },
    {
        "key": "obh_ff",
        "name": "OBH-FF",
        "lat": 17.44476,
        "lng": 78.34572,
        "category": "hostel",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"OBH-F{i}-{j:02d}", 2, "bedroom") for j in range(1, 16)]}
            for i in range(1, 4)
        ],
    },
    {
        "key": "bakul_nivas",
        "name": "Bakul Nivas",
        "lat": 17.44819,
        "lng": 78.34850,
        "category": "hostel",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"BN-{i}{j:02d}", 2, "bedroom") for j in range(1, 16)]}
            for i in range(1, 4)
        ],
    },
    {
        "key": "girls_hostel",
        "name": "Girls Hostel",
        "lat": 17.44757,
        "lng": 78.34741,
        "category": "girls_hostel",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"GH-{i}{j:02d}", 2, "bedroom") for j in range(1, 21)]}
            for i in range(1, 5)
        ],
    },
    {
        "key": "block_e_fsq",
        "name": "Block E, Faculty and Staff Quarters",
        "lat": 17.44434,
        "lng": 78.34796,
        "category": "residential",
        "floors": [
            {"label": f"Floor {i}", "rooms": [(f"BE-{i}{j:02d}", 3, "apartment") for j in range(1, 9)]}
            for i in range(1, 4)
        ],
    },
    {
        "key": "juice_canteen",
        "name": "Juice Canteen",
        "lat": 17.44793,
        "lng": 78.34758,
        "category": "canteen",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [("JC-Dining", 150, "canteen")],
            },
        ],
    },
    {
        "key": "basketball_canteen",
        "name": "Basketball Canteen",
        "lat": 17.44785,
        "lng": 78.34753,
        "category": "canteen",
        "floors": [
            {
                "label": "Ground Floor",
                "rooms": [("BC-Dining", 120, "canteen")],
            },
        ],
    },
    {
        "key": "amphitheater",
        "name": "Amphitheater",
        "lat": 17.44797,
        "lng": 78.34791,
        "category": "venue",
        "floors": [
            {
                "label": "Open Air",
                "rooms": [("Amph-Main", 1000, "arena")],
            },
        ],
    },
]

# ---------------------------------------------------------------------------
# Spring 2026 Timetable  (extracted from PDFs)
# ---------------------------------------------------------------------------
# Format: each entry = {
#   "course": str,
#   "day":   "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat",
#   "slot":  1-6  (slot number from timetable header)
#   "room":  str  (as printed in PDF)
#   "cohort":str  (which student cohort)
#   "half":  None | "H1" | "H2"   (half-semester courses)
# }
# Slot times:
#   1 → 08:30–09:55   2 → 10:05–11:30  3 → 11:40–13:05
#   4 → 14:00–15:25   5 → 15:35–17:00  6 → 17:10–18:40

SLOT_TIMES = {
    1: ("08:30", "09:55"),
    2: ("10:05", "11:30"),
    3: ("11:40", "13:05"),
    4: ("14:00", "15:25"),
    5: ("15:35", "17:00"),
    6: ("17:10", "18:40"),
}

# Lab slot on Mon/Fri afternoons: 14:00–17:00
LAB_SLOT_TIME = ("14:00", "17:00")

TIMETABLE: List[Dict[str, Any]] = [
    # ── MONDAY ──────────────────────────────────────────────────────────────
    # Slot 1
    {"course": "Computing in Sciences II", "day": "Mon", "slot": 1, "room": "H101", "cohort": "UG1_CND", "half": "H2"},
    {"course": "Differential Equations",   "day": "Mon", "slot": 1, "room": "H102", "cohort": "UG1",     "half": None},
    {"course": "Learning and Memory",       "day": "Mon", "slot": 1, "room": "H103", "cohort": "UG3_CSD", "half": None},
    {"course": "Making of Contemporary World","day":"Mon","slot": 1, "room": "H104", "cohort": "UG1_CHD", "half": None},
    {"course": "Design and Analysis of SW", "day": "Mon", "slot": 1, "room": "H105", "cohort": "UG2",     "half": None},
    {"course": "Advanced Structural Analysis","day":"Mon","slot": 1, "room": "H103", "cohort": "UG3",    "half": None},
    {"course": "Optimization Methods",      "day": "Mon", "slot": 1, "room": "H104", "cohort": "UG2",     "half": None},
    {"course": "Earthquake Engineering",    "day": "Mon", "slot": 1, "room": "H203", "cohort": "UG3",     "half": None},
    {"course": "CMOS Oscillator Design",    "day": "Mon", "slot": 1, "room": "H301", "cohort": "UG4",     "half": None},
    {"course": "Intro to IoT",              "day": "Mon", "slot": 1, "room": "H205", "cohort": "UG1_ECE", "half": None},
    {"course": "Computer Systems Org (B)",  "day": "Mon", "slot": 1, "room": "H205", "cohort": "UG1_CSE", "half": None},
    {"course": "Physics of Soft Condensed","day": "Mon", "slot": 1, "room": "H301", "cohort": "PhD",      "half": None},
    {"course": "Analog Electronic Circuits","day":"Mon", "slot": 1, "room": "SH2",  "cohort": "UG1_ECE", "half": None},
    {"course": "Communication Theory",      "day": "Mon", "slot": 1, "room": "SH3",  "cohort": "UG2_ECE", "half": None},
    # Slot 2
    {"course": "Basics of Ethics",           "day": "Mon", "slot": 2, "room": "H101", "cohort": "UG1",    "half": None},
    {"course": "Introduction to Linguistics II","day":"Mon","slot":2,"room": "H102", "cohort": "UG1_CLD", "half": None},
    {"course": "Mathematics of Information", "day": "Mon", "slot": 2, "room": "H101", "cohort": "UG2",    "half": "H1"},
    {"course": "Intro to Human Sciences (B)","day": "Mon", "slot": 2, "room": "H105", "cohort": "UG2_CSE","half": None},
    {"course": "Machine Learning Nat Sci",   "day": "Mon", "slot": 2, "room": "H202", "cohort": "MS",     "half": None},
    {"course": "Topics Discrete Math",       "day": "Mon", "slot": 2, "room": "H203", "cohort": "MS",     "half": None},
    {"course": "Responsible & Safe AI",      "day": "Mon", "slot": 2, "room": "H204", "cohort": "UG4",    "half": None},
    {"course": "Statistical Methods in AI",  "day": "Mon", "slot": 2, "room": "H105", "cohort": "MS",     "half": None},
    {"course": "Foundations Trustworthy Parallel","day":"Mon","slot":2,"room":"H301","cohort":"MS",        "half": "H2"},
    # Slot 3
    {"course": "Intro to Spatial Sciences",  "day": "Mon", "slot": 3, "room": "H102", "cohort": "UG2",    "half": "H2"},
    {"course": "Advanced Algorithms",        "day": "Mon", "slot": 3, "room": "H103", "cohort": "MS",     "half": None},
    {"course": "Thermodynamics",             "day": "Mon", "slot": 3, "room": "H104", "cohort": "UG1_CND","half": "H1"},
    {"course": "Topics in RL",               "day": "Mon", "slot": 3, "room": "H104", "cohort": "PhD",    "half": None},
    {"course": "Behavioral Research Stat",   "day": "Mon", "slot": 3, "room": "H105", "cohort": "UG3",    "half": None},
    {"course": "Organic Chemistry",          "day": "Mon", "slot": 3, "room": "H201", "cohort": "UG1_CND","half": "H2"},
    {"course": "Art Vision & Feelings",      "day": "Mon", "slot": 3, "room": "H201", "cohort": "MS",     "half": "H2"},
    {"course": "Computational Psycholinguistics","day":"Mon","slot":3,"room":"H202","cohort":"PhD",        "half": None},
    {"course": "Intro Human Sciences (A)",   "day": "Mon", "slot": 3, "room": "H205", "cohort": "UG2_ECE","half": None},
    {"course": "Disaster Management",        "day": "Mon", "slot": 3, "room": "H301", "cohort": "UG3",    "half": None},
    {"course": "Speech Signal Processing",   "day": "Mon", "slot": 3, "room": "H302", "cohort": "PhD",    "half": None},
    {"course": "Intro Processor Architecture","day":"Mon", "slot": 3, "room": "SH2",  "cohort": "UG2_ECE","half": "H1"},
    # Slot 4
    {"course": "Applications of Language Models","day":"Mon","slot":4,"room":"H101","cohort":"MS",        "half": None},
    {"course": "Robotics Planning Navigation","day":"Mon", "slot": 4, "room": "H102", "cohort": "MS",     "half": None},
    {"course": "Intro Info Security",        "day": "Mon", "slot": 4, "room": "H103", "cohort": "UG2",    "half": "H1"},
    {"course": "Growth and Development",     "day": "Mon", "slot": 4, "room": "H103", "cohort": "UG2",    "half": None},
    {"course": "Digital Signal Analysis",    "day": "Mon", "slot": 4, "room": "H103", "cohort": "UG3_ECE","half": "H2"},
    {"course": "Molecular Biology",          "day": "Mon", "slot": 4, "room": "H201", "cohort": "PhD",    "half": None},
    {"course": "Science II (UG3 ECE)",       "day": "Mon", "slot": 4, "room": "H103", "cohort": "UG3_ECE","half": None},
    {"course": "Statistical Methods in AI",  "day": "Mon", "slot": 4, "room": "SH1",  "cohort": "UG2",    "half": None},
    {"course": "Parallel Computing",         "day": "Mon", "slot": 4, "room": "SH2",  "cohort": "MS",     "half": None},
    # Slot 6
    {"course": "Law Technology Digital Governance","day":"Mon","slot":6,"room":"H201","cohort":"UG4",      "half": None},
    {"course": "Information & Communication","day": "Mon", "slot": 6, "room": "SH2",  "cohort": "UG2_ECE","half": None},
    # ── TUESDAY ──────────────────────────────────────────────────────────────
    {"course": "Virtual Reality Systems",    "day": "Tue", "slot": 1, "room": "H101", "cohort": "UG4",    "half": "H"},
    {"course": "Cognitive Science and AI",   "day": "Tue", "slot": 1, "room": "H102", "cohort": "MS",     "half": None},
    {"course": "Compilers",                  "day": "Tue", "slot": 1, "room": "H103", "cohort": "UG3_CSE","half": None},
    {"course": "Introduction to Game Theory","day": "Tue", "slot": 1, "room": "H104", "cohort": "UG3",    "half": None},
    {"course": "Intro to Statistical Signal","day": "Tue", "slot": 1, "room": "H103", "cohort": "UG2_ECE","half": "H2"},
    {"course": "Intro VLSI and Embedded",    "day": "Tue", "slot": 1, "room": "H103", "cohort": "UG2_ECE","half": "H1"},
    {"course": "Spatial Data Sciences",      "day": "Tue", "slot": 1, "room": "H202", "cohort": "MS",     "half": None},
    {"course": "Quantum Algorithms",         "day": "Tue", "slot": 1, "room": "H203", "cohort": "PhD",    "half": None},
    {"course": "Mathematical Methods Sci",   "day": "Tue", "slot": 1, "room": "H202", "cohort": "PhD",    "half": None},
    {"course": "Analog IC Design",           "day": "Tue", "slot": 1, "room": "H204", "cohort": "UG4_ECE","half": None},
    {"course": "Intro to Algorithms Eng",    "day": "Tue", "slot": 2, "room": "H101", "cohort": "UG2",    "half": "H2"},
    {"course": "Product Lifecycle Mgmt",     "day": "Tue", "slot": 2, "room": "H102", "cohort": "UG3",    "half": None},
    {"course": "Numerical Algorithms",       "day": "Tue", "slot": 2, "room": "H103", "cohort": "UG3",    "half": "H1"},
    {"course": "Language and Power",         "day": "Tue", "slot": 2, "room": "H104", "cohort": "MS",     "half": "H1"},
    {"course": "Data Systems",               "day": "Tue", "slot": 2, "room": "H105", "cohort": "UG3",    "half": None},
    {"course": "Geospatial for Sustainable", "day": "Tue", "slot": 2, "room": "H201", "cohort": "PhD",    "half": None},
    {"course": "Mathematics for Finance",    "day": "Tue", "slot": 2, "room": "H201", "cohort": "MS",     "half": None},
    {"course": "Computational Linguistics 1","day": "Tue", "slot": 2, "room": "H201", "cohort": "UG1_CLD","half": None},
    {"course": "Topics in Physics",          "day": "Tue", "slot": 2, "room": "H201", "cohort": "PhD",    "half": None},
    {"course": "Biomolecular Structures",    "day": "Tue", "slot": 3, "room": "H103", "cohort": "PhD",    "half": "H1"},
    {"course": "Intro Brain and Cognition",  "day": "Tue", "slot": 3, "room": "H103", "cohort": "UG3",    "half": "H2"},
    {"course": "Statistical Mechanics",      "day": "Tue", "slot": 3, "room": "H102", "cohort": "PhD",    "half": "H2"},
    {"course": "Quantum Info & Computation", "day": "Tue", "slot": 3, "room": "H101", "cohort": "PhD",    "half": "H1"},
    {"course": "Intro Quantum Info",         "day": "Tue", "slot": 3, "room": "H101", "cohort": "UG3",    "half": "H1"},
    {"course": "Performance Modelling CS",   "day": "Tue", "slot": 4, "room": "H102", "cohort": "MS",     "half": "H1"},
    {"course": "Hydro Informatics & Climate","day": "Tue", "slot": 4, "room": "H104", "cohort": "PhD",    "half": None},
    {"course": "Data Visualisation",         "day": "Tue", "slot": 4, "room": "H105", "cohort": "UG2",    "half": "H1"},
    {"course": "AI and Human Rights",        "day": "Tue", "slot": 4, "room": "H204", "cohort": "UG4",    "half": "H1"},
    {"course": "Ethics and Digital Society", "day": "Tue", "slot": 4, "room": "H203", "cohort": "UG3",    "half": "H1"},
    {"course": "Evaluation Methods NLP",     "day": "Tue", "slot": 4, "room": "H203", "cohort": "MS",     "half": "H2"},
    {"course": "Intro to Robotics Percep.",  "day": "Tue", "slot": 4, "room": "H203", "cohort": "MS",     "half": None},
    {"course": "Technology Product Entre.",  "day": "Tue", "slot": 4, "room": "H202", "cohort": "UG3",    "half": None},
    {"course": "Sustained Growth Strategy",  "day": "Tue", "slot": 5, "room": "H201", "cohort": "UG3",    "half": "H1"},
    {"course": "Sustainable Growth Startup", "day": "Tue", "slot": 5, "room": "H201", "cohort": "UG3",    "half": "H1"},
    {"course": "Theories Nationalism",       "day": "Tue", "slot": 5, "room": "H202", "cohort": "MS",     "half": None},
    {"course": "Principles Info Security",   "day": "Tue", "slot": 5, "room": "H105", "cohort": "UG3",    "half": None},
    # ── WEDNESDAY ───────────────────────────────────────────────────────────
    {"course": "Intro to Software Systems",  "day": "Wed", "slot": 3, "room": "H205", "cohort": "UG1_CSE","half": "H"},
    {"course": "Design & Analysis SW Sys (T)","day":"Wed","slot": 3, "room": "H205", "cohort": "UG2",     "half": None},
    {"course": "Intro Human Sciences (A)(T)","day": "Wed", "slot": 3, "room": "H205", "cohort": "UG2_ECE","half": None},
    {"course": "ADBI Tutorial",              "day": "Wed", "slot": 3, "room": "H301", "cohort": "UG3",    "half": None},
    {"course": "Info Theoretic Methods (T)", "day": "Wed", "slot": 3, "room": "B4-304","cohort": "MS",    "half": None},
    {"course": "Info & Communication (T)",   "day": "Wed", "slot": 3, "room": "SH1",  "cohort": "UG2_ECE","half": None},
    {"course": "Intro Processor Arch (T)",   "day": "Wed", "slot": 3, "room": "SH3",  "cohort": "UG2_ECE","half": None},
    {"course": "Communication Theory (T)",   "day": "Wed", "slot": 3, "room": "CR1",  "cohort": "UG2_ECE","half": None},
    {"course": "Data Visualisation Lab",     "day": "Wed", "slot": 2, "room": "H205", "cohort": "UG2",    "half": "H1"},
    # ── THURSDAY ────────────────────────────────────────────────────────────
    {"course": "Computing in Sciences II",   "day": "Thu", "slot": 1, "room": "H101", "cohort": "UG1_CND","half": "H2"},
    {"course": "Differential Equations",     "day": "Thu", "slot": 1, "room": "H102", "cohort": "UG1",    "half": None},
    {"course": "Design and Analysis of SW",  "day": "Thu", "slot": 1, "room": "H105", "cohort": "UG2",    "half": None},
    {"course": "Machine Learning Nat Sci",   "day": "Thu", "slot": 2, "room": "H202", "cohort": "MS",     "half": None},
    {"course": "Topics Discrete Math",       "day": "Thu", "slot": 2, "room": "H203", "cohort": "MS",     "half": None},
    {"course": "Responsible & Safe AI",      "day": "Thu", "slot": 2, "room": "H204", "cohort": "UG4",    "half": None},
    {"course": "Statistical Methods in AI",  "day": "Thu", "slot": 2, "room": "H105", "cohort": "MS",     "half": None},
    {"course": "Analog IC Design",           "day": "Thu", "slot": 4, "room": "H204", "cohort": "UG4_ECE","half": None},
    {"course": "Intro to Algorithms Eng",    "day": "Thu", "slot": 4, "room": "H101", "cohort": "UG2",    "half": "H2"},
    {"course": "Linear Algebra (T) G6",      "day": "Thu", "slot": 4, "room": "SH1",  "cohort": "UG1",    "half": None},
    {"course": "DSA Tutorial G1,G4",         "day": "Thu", "slot": 4, "room": "H101", "cohort": "UG1",    "half": None},
    {"course": "DSA Tutorial G2,G5",         "day": "Thu", "slot": 4, "room": "H301", "cohort": "UG1",    "half": None},
    {"course": "Intro to IoT LAB",           "day": "Thu", "slot": 4, "room": "H205", "cohort": "UG1_ECE","half": None},
    {"course": "CSO Tutorial G1-G5",         "day": "Thu", "slot": 3, "room": "H102", "cohort": "UG1_CSE","half": None},
    # ── FRIDAY ───────────────────────────────────────────────────────────────
    {"course": "Virtual Reality Systems",    "day": "Fri", "slot": 1, "room": "H101", "cohort": "UG4",    "half": "H"},
    {"course": "Cognitive Science and AI",   "day": "Fri", "slot": 1, "room": "H102", "cohort": "MS",     "half": None},
    {"course": "Compilers",                  "day": "Fri", "slot": 1, "room": "H103", "cohort": "UG3_CSE","half": None},
    {"course": "Intro to Game Theory",       "day": "Fri", "slot": 1, "room": "H104", "cohort": "UG3",    "half": None},
    {"course": "Data Systems",               "day": "Fri", "slot": 2, "room": "H105", "cohort": "UG3",    "half": None},
    {"course": "Geospatial for Sustainable", "day": "Fri", "slot": 2, "room": "H201", "cohort": "PhD",    "half": None},
    {"course": "Mathematics for Finance",    "day": "Fri", "slot": 2, "room": "H201", "cohort": "MS",     "half": None},
    {"course": "Intro to Software Systems",  "day": "Fri", "slot": 3, "room": "H205", "cohort": "UG1_CSE","half": "H"},
    {"course": "Compilers Tutorial",         "day": "Fri", "slot": 3, "room": "H103", "cohort": "UG3_CSE","half": None},
    {"course": "Intro Human Sciences (A)(T)","day": "Fri", "slot": 3, "room": "H205", "cohort": "UG2",    "half": None},
    {"course": "DSA LAB (C) G9-G12",        "day": "Fri", "slot": 4, "room": "TL1", "cohort": "UG1",     "half": None},
    {"course": "AEC Tutorial",               "day": "Fri", "slot": 4, "room": "H203", "cohort": "UG1_ECE","half": None},
    {"course": "Communication Theory (T)",   "day": "Fri", "slot": 4, "room": "CR1",  "cohort": "UG2_ECE","half": None},
    {"course": "El. Workshop II LAB",        "day": "Fri", "slot": 2, "room": "N-104", "cohort": "UG1_ECE","half": None},
    {"course": "Science Lab II",             "day": "Fri", "slot": 3, "room": "A3-301","cohort": "UG1_CND","half": None},
    # ── SATURDAY ─────────────────────────────────────────────────────────────
    {"course": "Communication Theory (T)",   "day": "Sat", "slot": 3, "room": "CR1",  "cohort": "UG2_ECE","half": None},
    {"course": "IQIC Tutorial",              "day": "Sat", "slot": 3, "room": "H102", "cohort": "PhD",    "half": None},
    {"course": "Makeup slot UG1",            "day": "Sat", "slot": 6, "room": "SH3",  "cohort": "UG1",    "half": None},
    {"course": "DSA LAB evening",            "day": "Tue", "slot": 6, "room": "TL1",  "cohort": "UG1",    "half": None},
    # ── MONDAY Labs ──────────────────────────────────────────────────────────
    {"course": "DSA LAB (A) G1-G4",         "day": "Mon", "slot": 4, "room": "TL1",  "cohort": "UG1",    "half": None},
    {"course": "Electronic Workshop II",     "day": "Mon", "slot": 4, "room": "N-104", "cohort": "UG1_ECE","half": None},
    # ── TUESDAY Labs ─────────────────────────────────────────────────────────
    {"course": "DSA LAB (B) G5-G8",         "day": "Tue", "slot": 4, "room": "TL1",  "cohort": "UG1",    "half": None},
    {"course": "El. Workshop II (Tue)",      "day": "Tue", "slot": 2, "room": "N-104", "cohort": "UG1_ECE","half": None},
    {"course": "Science Lab II (Tue)",       "day": "Tue", "slot": 3, "room": "A3-301","cohort": "UG1_CND","half": None},
]

# Cohort average attendance (used as expectedAttendance in bookings)
COHORT_ATTENDANCE = {
    "UG1":     550,
    "UG1_CSE": 200,
    "UG1_CLD": 80,
    "UG1_CND": 120,
    "UG1_ECE": 180,
    "UG1_CHD": 80,
    "UG2":     500,
    "UG2_CSE": 160,
    "UG2_ECE": 170,
    "UG3":     480,
    "UG3_CSE": 150,
    "UG3_ECE": 140,
    "UG4":     400,
    "UG4_ECE": 120,
    "MS":      200,
    "PhD":     120,
}

# ---------------------------------------------------------------------------
# Main seeder
# ---------------------------------------------------------------------------

class CampusSeeder:
    def __init__(self, backend: str, dry_run: bool):
        self.backend = backend.rstrip("/")
        self.dry_run = dry_run

        # Filled during seeding
        self.site_id: str = ""
        self.building_ids: Dict[str, str] = {}       # key → id
        self.room_name_to_id: Dict[str, str] = {}    # room_name → room_id
        self.lecture_event_type_id: str = ""
        self.lab_event_type_id: str = ""

    # ── helpers ─────────────────────────────────────────────────────────────

    def _url(self, path: str) -> str:
        return f"{self.backend}{path}"

    def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return _post(self._url(path), payload, self.dry_run)

    # ── step 1 : site ───────────────────────────────────────────────────────

    def seed_site(self) -> None:
        print("  Creating IIIT-H site …")
        resp = self.post("/sites", {
            "name": "IIIT Hyderabad Campus",
            "geoBoundary": {
                "type": "Polygon",
                "coordinates": [
                    [78.3455, 17.4430],
                    [78.3520, 17.4430],
                    [78.3520, 17.4485],
                    [78.3455, 17.4485],
                    [78.3455, 17.4430],
                ],
            },
        })
        self.site_id = resp.get("id", "dry-run-site")
        print(f"    ✓ Site id = {self.site_id}")

    # ── step 2 : buildings + floors + rooms ─────────────────────────────────

    def seed_buildings(self) -> None:
        print("  Creating buildings, floors and rooms …")
        for bspec in CAMPUS_BUILDINGS:
            print(f"    Building: {bspec['name']}")
            # Create building
            b_resp = self.post("/buildings", {
                "siteId": self.site_id,
                "name": bspec["name"],
                "location": {"lat": bspec["lat"], "lng": bspec["lng"]},
                "category": bspec["category"],
            })
            bid = b_resp.get("id", "dry-id")
            self.building_ids[bspec["key"]] = bid

            # Create rooms in each floor
            for floor_spec in bspec["floors"]:
                floor_label = floor_spec["label"]
                for (room_name, capacity, room_type) in floor_spec["rooms"]:
                    r_resp = self.post("/rooms", {
                        "buildingId": bid,
                        "name": room_name,
                        "floor": floor_label,
                        "capacity": capacity,
                        "roomType": room_type,
                        "status": "available",
                        "accessibilityScore": 0.75,
                        "estimatedCost": 0.0,
                    })
                    self.room_name_to_id[room_name] = r_resp.get("id", "dry-room-id")

        print(f"    ✓ {len(self.building_ids)} buildings, {len(self.room_name_to_id)} rooms")

    # ── step 3 : event types ────────────────────────────────────────────────

    def seed_event_types(self) -> None:
        print("  Creating event types …")
        lec = self.post("/event-types", {"name": "Lecture", "isCustom": False})
        lab = self.post("/event-types", {"name": "Lab / Tutorial", "isCustom": False})
        self.lecture_event_type_id = lec.get("id", "dry-lec-id")
        self.lab_event_type_id = lab.get("id", "dry-lab-id")

        # Create minimal profiles for both
        for etype_id, _label in [
            (self.lecture_event_type_id, "Lecture"),
            (self.lab_event_type_id, "Lab / Tutorial"),
        ]:
            self.post("/event-profiles", {
                "eventTypeId": etype_id,
                "configJson": {
                    "capacity_buffer": 1.0,
                    "occupancy_threshold": 0.95,
                    "attendance_tiers": [
                        {
                            "min_attendance": 1,
                            "max_attendance": 10000,
                            "requirements": [],
                        }
                    ],
                    "legal_rules": {
                        "min_emergency_exit_per_200": 1,
                        "max_people_per_washroom": 200,
                    },
                },
            })
        print("    ✓ Lecture & Lab/Tutorial event types created")

    # ── step 4 : timetable bookings ─────────────────────────────────────────

    def seed_timetable(self) -> None:
        print("  Seeding Spring 2026 timetable bookings …")
        today = date.today()
        # Find the Monday of the current week as anchor
        days_since_mon = today.weekday()
        week_start = today  # Use today's actual date for the demo week

        day_offsets = {
            "Mon": 0, "Tue": 1, "Wed": 2,
            "Thu": 3, "Fri": 4, "Sat": 5,
        }

        created, skipped = 0, 0
        for entry in TIMETABLE:
            day_offset = day_offsets.get(entry["day"], 0)
            slot_n = entry["slot"]
            times = SLOT_TIMES.get(slot_n, ("08:00", "09:30"))
            event_date = week_start  # anchor to today for demo; in prod you'd loop weeks

            start_iso = f"{event_date}T{times[0]}:00"
            end_iso   = f"{event_date}T{times[1]}:00"

            room_name = entry["room"]
            room_id = self.room_name_to_id.get(room_name)
            if not room_id:
                skipped += 1
                continue

            cohort = entry["cohort"]
            attendance = COHORT_ATTENDANCE.get(cohort, 60)
            is_lab = "LAB" in entry["course"].upper() or "Lab" in room_name or "Tutorial" in entry["course"]
            etype_id = self.lab_event_type_id if is_lab else self.lecture_event_type_id

            course_label = entry["course"]
            if entry.get("half"):
                course_label += f" ({entry['half']})"

            try:
                self.post("/bookings", {
                    "eventName": f"{course_label} – {room_name} [{entry['day']} S{slot_n}]",
                    "eventTypeId": etype_id,
                    "expectedAttendance": attendance,
                    "startAt": start_iso,
                    "endAt": end_iso,
                    "siteScope": [self.site_id],
                    "buildingScope": [],
                    "status": "confirmed",
                })
                created += 1
            except Exception as exc:
                skipped += 1
                if self.dry_run:
                    print(f"      skipping {course_label}: {exc}")

        print(f"    ✓ {created} bookings created, {skipped} skipped (room not found or error)")

    # ── run ─────────────────────────────────────────────────────────────────

    def run(self, reset: bool = False) -> None:
        if reset and not self.dry_run:
            print("  Resetting existing allocation stores …")
            try:
                _post(self._url("/allocations/seed"), {"force": True}, dry_run=False)
            except Exception:
                pass  # endpoint might not exist; that's fine

        print()
        self.seed_site()
        self.seed_buildings()
        self.seed_event_types()
        self.seed_timetable()
        print()
        print("✅  Campus seed complete.")
        print(f"   Site    : IIIT Hyderabad Campus ({self.site_id})")
        print(f"   Buildings: {len(self.building_ids)}")
        print(f"   Rooms    : {len(self.room_name_to_id)}")
        print(f"   Timetable: {len(TIMETABLE)} entries processed")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Seed IIIT-H campus buildings and timetable into CrowdTwin backend")
    p.add_argument("--backend",  default=DEFAULT_BACKEND, help="Backend base URL")
    p.add_argument("--reset",    action="store_true",     help="Force-reset existing allocation stores first")
    p.add_argument("--dry-run",  action="store_true",     help="Print payloads without POSTing")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    print("🏫 IIIT-H Campus Seeder")
    print(f"   Backend : {args.backend}")
    print(f"   Dry-run : {args.dry_run}")
    print(f"   Reset   : {args.reset}")

    seeder = CampusSeeder(backend=args.backend, dry_run=args.dry_run)
    try:
        seeder.run(reset=args.reset)
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        sys.exit(1)
    except urllib.error.URLError as exc:
        print(f"\n❌  Cannot reach backend at {args.backend}: {exc}")
        print("    Start the backend first:  cd backend && uvicorn main:app --port 8904")
        sys.exit(1)


if __name__ == "__main__":
    main()
