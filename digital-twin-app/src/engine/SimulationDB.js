export const SimulationDB = {
    // Semantic Building mappings
    categories: {
        hostels: [
            "OBH", "NBH", "Bakul Nivas", "Parijaat Nivas", "Kadamb Nivas", 
            "Guesthouse", "Hostel", "Guest House"
        ],
        academics: [
            "Nilgiri", "Vindhya", "Himalaya", "Kohinoor", 
            "Academic Block", "Lab Complex", "Research Centre", "Library"
        ],
        canteens: [
            "Yuktaahar", "Kadamb Non-Veg", "Juice Canteen", "VC Canteen", "David's Canteen",
            "Canteen"
        ],
        recreation: [
            "Sports Ground", "Basketball Court", "Tennis Court", "Football Ground",
            "Gymnasium", "Amphitheatre", "Lawn"
        ],
        admin: [
            "Main Building", "Admin Block"
        ],
        gates: [
            "Main Gate", "Gate 1", "Gate 2"
        ]
    },

    // Agent Profiles and their default hourly destinations based on 24hr format
    // Keys represent hour of the day (e.g. 8 = 08:00 AM)
    agents: [
        {
            profile: "First Year Student",
            color: 0xef4444, // Red shirt
            count: 300,
            schedule: {
                0: "hostels",   // Sleep
                7: "hostels",   // Wake up
                8: "academics", // Mandatory morning classes
                12: "canteens", // Lunch rush
                13: "academics",// Labs
                17: "recreation",// Sports
                19: "canteens", // Dinner
                20: "hostels",  // Return
                22: "hostels"   // Sleep
            }
        },
        {
            profile: "Second Year Student",
            color: 0x3b82f6, // Blue shirt
            count: 280,
            schedule: {
                0: "hostels",
                8: "canteens",  // Breakfast first
                9: "academics", // Classes start later
                12: "canteens", // Early lunch
                14: "academics",
                16: "recreation",
                20: "hostels",
                21: "academics",// Night library/labs
                23: "hostels"
            }
        },
        {
            profile: "Third Year Student",
            color: 0x10b981, // Green shirt
            count: 250,
            schedule: {
                0: "hostels",
                9: "academics", // Project labs
                13: "canteens", 
                14: "academics",
                18: "hostels",
                20: "canteens",
                22: "academics" // Late night grinds
            }
        },
        {
            profile: "Fourth Year Student",
            color: 0xf59e0b, // Yellow shirt
            count: 200,
            schedule: {
                0: "hostels",
                10: "academics",// Flexible timings
                14: "hostels",
                16: "recreation",
                19: "canteens",
                21: "hostels"
            }
        },
        {
            profile: "Faculty",
            color: 0x64748b, // Grey shirt
            count: 100,
            schedule: {
                0: "admin",     // Assuming staff housing or off-campus
                8: "gates",     // Arrive at campus
                9: "academics", // Teach
                13: "admin",    // Lunch/Staff room
                14: "academics",// Teach
                17: "gates",    // Leave campus
                18: "admin"
            }
        },
        {
            profile: "Staff",
            color: 0x8b5cf6, // Purple shirt
            count: 80,
            schedule: {
                0: "admin",
                6: "gates",     // Early arrival
                7: "canteens",  // Prep food
                10: "academics",// Maintenance
                14: "canteens",
                16: "gates",    // Shift end
                17: "admin"
            }
        }
    ],

    // Utility mapping logic to classify a building name from GeoJSON
    classifyBuilding(name) {
        if (!name) return "other";
        const lowerName = name.toLowerCase();
        
        for (const [category, keywords] of Object.entries(this.categories)) {
            if (keywords.some(k => lowerName.includes(k.toLowerCase()))) {
                return category;
            }
        }
        return "other";
    },

    // Gets the target category for a specific profile at a given hour
    getTargetCategory(profileName, hour) {
        const agent = this.agents.find(a => a.profile === profileName);
        if (!agent) return "hostels";

        // Find the most recent schedule entry before or equal to current hour
        const scheduleKeys = Object.keys(agent.schedule).map(Number).sort((a,b) => a-b);
        let targetHour = 0;
        for (const k of scheduleKeys) {
            if (hour >= k) targetHour = k;
        }
        
        return agent.schedule[targetHour];
    }
};
