import sys
import os
import json
import re
import pdfplumber

def parse_course_offerings(pdf_path):
    print(f"Parsing {pdf_path}...")
    courses = {}
    if not os.path.exists(pdf_path):
        print(f"File not found: {pdf_path}")
        return courses
        
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for _t in tables:
                for row in _t:
                    if not row or len(row) < 5: continue
                    cno = str(row[2]).strip()
                    cname = str(row[3]).strip().replace('\n', ' ')
                    # Basic validation: Course No should look like CS1.201 or HS8.102b
                    if cno and len(cno) > 3 and '.' in cno:
                        credits = str(row[4]).strip()
                        faculty = str(row[5]).strip().replace('\n', ' ') if len(row) > 5 and row[5] else ""
                        courses[cname] = {
                            "course_id": cno,
                            "name": cname,
                            "credits": credits,
                            "faculty": faculty
                        }
    print(f"Found {len(courses)} courses.")
    return courses

def extract_cells_from_timetable(pdf_path):
    print(f"Parsing timetable {pdf_path}...")
    bookings = []
    rooms = set()
    
    if not os.path.exists(pdf_path):
        print(f"File not found: {pdf_path}")
        return bookings, rooms
        
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for _t in tables:
                if not _t or len(_t) < 2: continue
                # First row usually has the time slots in column 1..N
                header = _t[0]
                
                for row in _t[1:]:
                    if not row or not row[0]: continue
                    day = str(row[0]).strip().replace('\n', ' ')
                    # Process each timeslot
                    for col_idx in range(1, len(row)):
                        cell = row[col_idx]
                        if not cell: continue
                        
                        slot_name = str(header[col_idx]).strip().replace('\n', ' ') if col_idx < len(header) and header[col_idx] else f"Slot {col_idx}"
                        
                        # cell usually contains CSV separated courses
                        # e.g. "Linear Alg.-(T) - G12 - H303, DSA-(T) - G9 (H301)" etc.
                        items = str(cell).split(',')
                        for item in items:
                            item = item.strip().replace('\n', ' ')
                            if not item: continue
                            
                            # Simple extraction: look for room identifiers
                            # such as H101, SH1, B6-309, N-104, CR1
                            room_match = re.search(r'-(H\d{3}|SH\d+|B\d+-\d+|N-\d+|CR\d+|TL\d+|A3-\d+|H-\d{3})', item)
                            room = "Unknown"
                            if room_match:
                                room = room_match.group(1).replace('-','')
                                rooms.add(room)
                            
                            bookings.append({
                                "day": day,
                                "slot": slot_name,
                                "raw_text": item,
                                "room": room
                            })
    return bookings, rooms

if __name__ == "__main__":
    base_dir = "/Users/likhithkanigolla/IIITH/code-files/Digital-Twin/Crowd"
    offerings_pdf = os.path.join(base_dir, "Course_Offerings-Spring26-V4.pdf")
    lecture_pdf = os.path.join(base_dir, "Lecture timetable for Spring 2026_V5.pdf")
    lab_pdf = os.path.join(base_dir, "Lab & Tutorial Timetable S26-V7.pdf")
    
    courses = parse_course_offerings(offerings_pdf)
    
    l_bookings, l_rooms = extract_cells_from_timetable(lecture_pdf)
    tut_bookings, tut_rooms = extract_cells_from_timetable(lab_pdf)
    
    all_rooms = list(l_rooms.union(tut_rooms))
    all_bookings = l_bookings + tut_bookings
    
    # Save to data directory
    out_dir = os.path.join(base_dir, "backend", "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "campus_data_real.json")
    
    output = {
        "rooms": sorted(all_rooms),
        "courses": courses,
        "bookings": all_bookings
    }
    
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Saved real campus data to {out_path} with {len(all_rooms)} rooms and {len(all_bookings)} bookings.")
