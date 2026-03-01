// A simple priority queue for A*
class PriorityQueue {
    constructor() {
        this.elements = [];
    }
    
    enqueue(element, priority) {
        this.elements.push({ element, priority });
        this.elements.sort((a, b) => a.priority - b.priority);
    }
    
    dequeue() {
        return this.elements.shift().element;
    }
    
    isEmpty() {
        return this.elements.length === 0;
    }
}

export class NavigationGraph {
    constructor() {
        this.nodes = new Map(); // id -> {x, y, neighbors: [{nodeId, cost, roadName}]}
        this.nextNodeId = 0;
        this.blockedRoads = new Set(); // Set of blocked road names/IDs
        this.roadSegments = new Map(); // roadName -> [{nodeId1, nodeId2}] for highlighting
    }

    // Set a road as blocked (agents can't use it)
    setRoadBlocked(roadName, blocked = true) {
        const normalizedName = roadName.toLowerCase().replace(/\s+/g, '_');
        if (blocked) {
            this.blockedRoads.add(normalizedName);
        } else {
            this.blockedRoads.delete(normalizedName);
        }
        console.log(`NavigationGraph: Road "${roadName}" ${blocked ? 'blocked' : 'unblocked'}`);
    }

    // Check if a road is blocked
    isRoadBlocked(roadName) {
        if (!roadName) return false;
        const normalizedName = roadName.toLowerCase().replace(/\s+/g, '_');
        return this.blockedRoads.has(normalizedName);
    }

    // Clear all road blocks
    clearAllBlocks() {
        this.blockedRoads.clear();
    }

    // Get all road names in the graph
    getAllRoadNames() {
        return Array.from(this.roadSegments.keys());
    }

    // Heuristic: Straight-line distance
    heuristic(nodeA, nodeB) {
        return Math.hypot(nodeA.x - nodeB.x, nodeA.y - nodeB.y);
    }

    // Find the closest node in the graph to a given map coordinate
    getClosestNode(lng, lat) {
        let closestId = null;
        let minDist = Infinity;
        
        for (const [id, node] of this.nodes.entries()) {
            const dist = Math.hypot(node.x - lng, node.y - lat);
            if (dist < minDist) {
                minDist = dist;
                closestId = id;
            }
        }
        return closestId;
    }

    // Build the graph from OpenStreetMap LineString pathways
    buildFromGeoJSON(pathwaysFeatureCollection) {
        this.nodes.clear();
        this.roadSegments.clear();
        this.nextNodeId = 0;
        
        // A temporary map to find existing nodes at exact coordinates
        // Key: "lng_lat", Value: nodeId
        const coordMap = new Map();
        
        const getOrCreateNode = (lng, lat) => {
            const key = `${lng.toFixed(6)}_${lat.toFixed(6)}`;
            if (coordMap.has(key)) {
                return coordMap.get(key);
            }
            const id = this.nextNodeId++;
            this.nodes.set(id, { x: lng, y: lat, neighbors: [] });
            coordMap.set(key, id);
            return id;
        };

        pathwaysFeatureCollection.features.forEach(feature => {
            if (feature.geometry.type === 'LineString') {
                const coords = feature.geometry.coordinates;
                // Get road name from properties
                const roadName = feature.properties?.name || 
                                 feature.properties?.highway || 
                                 `road_${this.roadSegments.size}`;
                const normalizedName = roadName.toLowerCase().replace(/\s+/g, '_');
                
                if (!this.roadSegments.has(normalizedName)) {
                    this.roadSegments.set(normalizedName, []);
                }
                
                for (let i = 0; i < coords.length - 1; i++) {
                    const p1 = coords[i];
                    const p2 = coords[i+1];
                    
                    const id1 = getOrCreateNode(p1[0], p1[1]);
                    const id2 = getOrCreateNode(p2[0], p2[1]);
                    
                    const dist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
                    
                    // Store road name with each edge
                    this.nodes.get(id1).neighbors.push({ nodeId: id2, cost: dist, roadName: normalizedName });
                    this.nodes.get(id2).neighbors.push({ nodeId: id1, cost: dist, roadName: normalizedName });
                    
                    // Track segments for this road
                    this.roadSegments.get(normalizedName).push({ nodeId1: id1, nodeId2: id2 });
                }
            }
        });
        
        console.log(`Navigation graph built with ${this.nodes.size} nodes, ${this.roadSegments.size} named roads.`);
    }

    // A* Pathfinding Algorithm (respects blocked roads)
    findPath(startLngLat, endLngLat) {
        if (this.nodes.size === 0) return [startLngLat, endLngLat]; // Fallback if no graph

        const startNodeId = this.getClosestNode(startLngLat.lng, startLngLat.lat);
        const endNodeId = this.getClosestNode(endLngLat.lng, endLngLat.lat);

        if (startNodeId === null || endNodeId === null) return [startLngLat, endLngLat];
        if (startNodeId === endNodeId) return [startLngLat, endLngLat]; // Already there

        const frontier = new PriorityQueue();
        frontier.enqueue(startNodeId, 0);

        const cameFrom = new Map();
        const costSoFar = new Map();

        cameFrom.set(startNodeId, null);
        costSoFar.set(startNodeId, 0);

        let found = false;

        while (!frontier.isEmpty()) {
            const current = frontier.dequeue();

            if (current === endNodeId) {
                found = true;
                break;
            }

            const neighbors = this.nodes.get(current).neighbors;
            for (const next of neighbors) {
                // Skip this edge if the road is blocked
                if (next.roadName && this.isRoadBlocked(next.roadName)) {
                    continue;
                }
                
                const newCost = costSoFar.get(current) + next.cost;
                if (!costSoFar.has(next.nodeId) || newCost < costSoFar.get(next.nodeId)) {
                    costSoFar.set(next.nodeId, newCost);
                    // Add heuristic for A*
                    const priority = newCost + this.heuristic(this.nodes.get(endNodeId), this.nodes.get(next.nodeId));
                    frontier.enqueue(next.nodeId, priority);
                    cameFrom.set(next.nodeId, current);
                }
            }
        }

        if (!found) return [startLngLat, endLngLat]; // No path found (may be due to blocked roads)

        // Reconstruct path
        let currentId = endNodeId;
        const pathIds = [];
        while (currentId !== null) {
            pathIds.push(currentId);
            currentId = cameFrom.get(currentId);
        }
        
        // Reverse so it goes start to end
        pathIds.reverse();

        // Convert back to lng/lat waypoints
        // Optional: Include exact start and end points
        const waypoints = [startLngLat];
        for (const id of pathIds) {
            const n = this.nodes.get(id);
            waypoints.push({ lng: n.x, lat: n.y });
        }
        waypoints.push(endLngLat);

        return waypoints;
    }
}
