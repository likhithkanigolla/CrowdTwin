import * as THREE from 'three';
import maplibregl from 'maplibre-gl';

export const CrowdLayer = function(id) {
  this.id = id;
  this.type = 'custom';
  this.renderingMode = '3d';
  
  this.camera = new THREE.Camera();
  this.scene = new THREE.Scene();

  // Day/Night Lighting setup
  this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
  this.sunLight.castShadow = true;
  this.scene.add(this.sunLight);
  
  this.ambientLight = new THREE.AmbientLight(0x404040, 1.0); // Soft white light
  this.scene.add(this.ambientLight);

  // Streetlights (Point lights that simulate light scatter)
  this.streetLights = new THREE.Group();
  this.scene.add(this.streetLights);

  this.agents = [];
  this.simTime = 7.75; // Default morning
  this.navGraph = null;
};

CrowdLayer.prototype.setNavigationGraph = function(navGraph) {
    this.navGraph = navGraph;
};

CrowdLayer.prototype.initInstancedRenderers = function() {
    this.maxAgents = 10000;
    // Scale up the agents artificially for visibility (e.g. 10x)
    this.agentScaleArtifical = 5.0; 
    
    // Geometry is built with unit meter size
    const headGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const bodyGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.6, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.8, 8);
    legGeo.rotateX(Math.PI / 2);

    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff }); 

    this.instHead = new THREE.InstancedMesh(headGeo, mat.clone(), this.maxAgents);
    this.instBody = new THREE.InstancedMesh(bodyGeo, mat.clone(), this.maxAgents);
    this.instLeftLeg = new THREE.InstancedMesh(legGeo, mat.clone(), this.maxAgents);
    this.instRightLeg = new THREE.InstancedMesh(legGeo, mat.clone(), this.maxAgents);

    this.instHead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instLeftLeg.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instRightLeg.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.scene.add(this.instHead);
    this.scene.add(this.instBody);
    this.scene.add(this.instLeftLeg);
    this.scene.add(this.instRightLeg);
};

CrowdLayer.prototype.onAdd = function(map, gl) {
  this.map = map;
  this.renderer = new THREE.WebGLRenderer({
    canvas: map.getCanvas(),
    context: gl,
    antialias: true,
    alpha: true
  });
  this.renderer.autoClear = false;
  
  // Need depth testing for proper 3d rendering, but Maplibre handles its own depth.
  // We'll adjust Z translations.
  this.initInstancedRenderers();
};

CrowdLayer.prototype.setSimTime = function(time) {
    this.simTime = time;
    this.updateLighting();
};

CrowdLayer.prototype.updateLighting = function() {
    // simTime is 0 to 24. 
    // Sun rises at 6, peaks at 12, sets at 18
    const time = this.simTime;
    
    // Calculate sun position (simple arc over X axis)
    // At time=6, angle=0. At time=12, angle=PI/2. At time=18, angle=PI
    const daylightHours = 12; // 6am to 6pm
    const sunAngle = ((time - 6) / daylightHours) * Math.PI;
    
    if (time >= 6 && time <= 18) {
        // Daytime
        const elevation = Math.sin(sunAngle);
        const azimuth = Math.cos(sunAngle);
        this.sunLight.position.set(azimuth, 0, elevation).normalize();
        this.sunLight.intensity = Math.max(0.2, elevation * 1.5);
        this.ambientLight.intensity = 0.6 + (elevation * 0.4);
        
        // Dawn/Dusk tinting
        if (time < 8) this.sunLight.color.setHex(0xffcba4); // Morning warm
        else if (time > 16) this.sunLight.color.setHex(0xffa07a); // Evening orange
        else this.sunLight.color.setHex(0xffffff); // Midday white
        
        // Turn off streetlights
        this.streetLights.visible = false;
    } else {
        // Nighttime
        this.sunLight.intensity = 0;
        this.ambientLight.intensity = 0.2; // Dark ambient
        
        // Turn on streetlights
        this.streetLights.visible = true;
    }
};

CrowdLayer.prototype.render = function(gl, matrix) {
  if (!this.renderer) return;

  // Sync lighting with simTime (which should be updated from outside)
  this.updateLighting();

  // Apply MapLibre projection matrix
  const m = new THREE.Matrix4().fromArray(matrix);
  const l = new THREE.Matrix4().makeTranslation(
    this.modelTransform?.translateX || 0,
    this.modelTransform?.translateY || 0,
    this.modelTransform?.translateZ || 0
  )
  .scale(new THREE.Vector3(
    this.modelTransform?.scale || 1,
    this.modelTransform?.scale || 1,
    this.modelTransform?.scale || 1
  ));

  this.camera.projectionMatrix = m.multiply(l);
  
  // Custom logic to animate agents
  this.animateAgents();

  this.renderer.resetState();
  // Clear depth buffer so ThreeJS renders on top of MapLibre layers predictably
  this.renderer.clearDepth();
  this.renderer.render(this.scene, this.camera);
  
  if (this.map && this.agents.length > 0) {
    this.map.triggerRepaint();
  }
};

// Create simple trees
CrowdLayer.prototype.createTreeModel = function() {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c4033 });
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.0, 5);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.rotation.x = Math.PI / 2;
  trunk.position.set(0, 0, 0.5);

  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x166534 });
  const leavesGeo = new THREE.ConeGeometry(1.2, 3.0, 5);
  const leaves = new THREE.Mesh(leavesGeo, leavesMat);
  leaves.rotation.x = Math.PI / 2;
  leaves.position.set(0, 0, 2.5);

  group.add(trunk);
  group.add(leaves);
  return group;
};

// Utility to convert LngLat to Three context relative
CrowdLayer.prototype.lngLatToPosition = function(lngLat) {
  const mercator = maplibregl.MercatorCoordinate.fromLngLat(lngLat, 0);
  return new THREE.Vector3(mercator.x, mercator.y, mercator.z);
};

// Spawn trees across polygons
CrowdLayer.prototype.populateTrees = function(geojsonGreenAreas) {
  if(!this.map) return;
  const center = this.map.getCenter();
  const centerMercator = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
  const scale = centerMercator.meterInMercatorCoordinateUnits();

    // Define transform to center local map units to minimize precision loss
    this.modelTransform = {
      translateX: 0,
      translateY: 0,
      translateZ: 0,
      scale: 1 // We apply scale per object
    };

    geojsonGreenAreas.features.forEach((feature) => {
      // Just randomly scatter trees in bounding box of polygon for simplicity
      // A more robust way is triangulating polygons.
      if (feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0];
        // naive bounding box
        let minX = 180, maxX = -180, minY = 90, maxY = -90;
        coords.forEach(([lng, lat]) => {
          if (lng < minX) minX = lng;
          if (lng > maxX) maxX = lng;
          if (lat < minY) minY = lat;
          if (lat > maxY) maxY = lat;
        });

        // Spawn 2-5 trees per green area
        const treeCount = Math.floor(Math.random() * 4) + 2;
        for (let i = 0; i < treeCount; i++) {
          const rLng = minX + Math.random() * (maxX - minX);
          const rLat = minY + Math.random() * (maxY - minY);
          const pos = this.lngLatToPosition({ lng: rLng, lat: rLat });
          pos.z += 0.5 * scale; // Float slightly above ground mesh to avoid Z clipping
          
          const tree = this.createTreeModel();
          tree.position.copy(pos);
          tree.scale.set(scale, scale, scale); // scale meters to mercator
          
      // Randomize tree size slightly
      const size = 0.8 + Math.random() * 0.6;
      tree.scale.multiplyScalar(size);
      
      this.scene.add(tree);
    }
  }
  });
  this.map.triggerRepaint();
};

// Spawn streetlights along pathways
CrowdLayer.prototype.populateStreetLights = function(geojsonPathways) {
  if(!this.map) return;
  const center = this.map.getCenter();
  const scale = maplibregl.MercatorCoordinate.fromLngLat(center, 0).meterInMercatorCoordinateUnits();

  // Clear existing
  while(this.streetLights.children.length > 0){ 
      this.streetLights.remove(this.streetLights.children[0]); 
  }

  // Add a few point lights along some paths
  geojsonPathways.features.forEach((feature, index) => {
      // Just pick every Nth path to avoid too many lights
      if (index % 5 !== 0) return;
      if (feature.geometry.type === 'LineString') {
          const coords = feature.geometry.coordinates;
          if (coords.length > 1) {
              const midPoint = coords[Math.floor(coords.length / 2)];
              const pos = this.lngLatToPosition({ lng: midPoint[0], lat: midPoint[1] });
              pos.z = 4 * scale; // 4 meters high light post

              const light = new THREE.PointLight(0xffddaa, 2.0, 150 * scale); // warm glow, reach 150m
              light.position.copy(pos);
              
              // Add a small visible glowing mesh for the bulb
              const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
              const bulbGeo = new THREE.SphereGeometry(1.0, 8, 8); // 1 unit in Three JS
              const bulb = new THREE.Mesh(bulbGeo, bulbMat);
              bulb.position.copy(pos);
              bulb.scale.set(scale, scale, scale);
              
              const group = new THREE.Group();
              group.add(light);
              group.add(bulb);
              
              this.streetLights.add(group);
          }
      }
  });
};

CrowdLayer.prototype.spawnAgent = function(startLngLat, destLngLat, speedMultiplier = 1, shirtColorInput = null) {
  if(!this.map || this.agents.length >= this.maxAgents) return;
  
  // Calculate A* pathway points if graph exists
  let waypointsLngLat = [startLngLat, destLngLat];
  if (this.navGraph) {
      waypointsLngLat = this.navGraph.findPath(startLngLat, destLngLat);
  }

  // Convert all waypoints to 3D positions
  const center = this.map.getCenter();
  const scale = maplibregl.MercatorCoordinate.fromLngLat(center, 0).meterInMercatorCoordinateUnits();
  
  const waypoints = waypointsLngLat.map(w => {
      const p = this.lngLatToPosition(w);
      p.z += 1.0 * scale; // Elevate
      return p;
  });

  const skinTones = [0xffd1b3, 0xe2b999, 0xc68642, 0x8d5524, 0x4a2c11];
  const skinColorHex = skinTones[Math.floor(Math.random() * skinTones.length)];
  const shirtColorHex = shirtColorInput !== null ? parseInt(shirtColorInput.toString().replace('#',''), 16) : 0xffffff;
  
  const skinColor = new THREE.Color(skinColorHex);
  const shirtColor = new THREE.Color(shirtColorHex);
  const pantColor = new THREE.Color(0x1e293b);

  this.agents.push({
      waypoints: waypoints,
      waypointIndex: 0,
      pos: waypoints[0].clone(),
      angle: 0,
      progress: 0,
      speed: (0.0001 + Math.random() * 0.00005) * speedMultiplier, // speed varies based on segment distance
      walkCycle: Math.random() * Math.PI * 2,
      skinColor,
      shirtColor,
      pantColor
  });

  this.map.triggerRepaint();
};

CrowdLayer.prototype.animateAgents = function() {
  if(!this.instHead) return;
  const center = this.map.getCenter();
  const scale = maplibregl.MercatorCoordinate.fromLngLat(center, 0).meterInMercatorCoordinateUnits();
  const agentScale = scale * (this.agentScaleArtifical || 5.0); // Make them highly visible

  const _matrix = new THREE.Matrix4();
  const _position = new THREE.Vector3();
  const _rotation = new THREE.Quaternion();
  const _scale = new THREE.Vector3(agentScale, agentScale, agentScale);

  this.instHead.count = this.agents.length;
  this.instBody.count = this.agents.length;
  this.instLeftLeg.count = this.agents.length;
  this.instRightLeg.count = this.agents.length;

  for (let i = this.agents.length - 1; i >= 0; i--) {
    const agent = this.agents[i];
    
    // Path routing iteration
    let currentTarget = agent.waypoints[agent.waypointIndex + 1];
    
    if (!currentTarget) {
        // Reached end of path, despawn
        this.agents.splice(i, 1);
        continue;
    }

    const dist = agent.pos.distanceTo(currentTarget);
    // adjust progress step based on segment length to keep constant speed
    const step = agent.speed * (scale / Math.max(0.000001, dist));
    
    agent.progress += step;

    if (agent.progress >= 1) {
        agent.progress = 0;
        agent.waypointIndex++;
        if (agent.waypointIndex >= agent.waypoints.length - 1) {
            this.agents.splice(i, 1);
            continue;
        }
        currentTarget = agent.waypoints[agent.waypointIndex + 1];
    }
    
    const startPos = agent.waypoints[agent.waypointIndex];
    agent.pos.lerpVectors(startPos, currentTarget, agent.progress);

    // Look at target
    const dx = currentTarget.x - agent.pos.x;
    const dy = currentTarget.y - agent.pos.y;
    agent.angle = Math.atan2(dy, dx) - Math.PI/2;
    
    // Walk cycle animation
    agent.walkCycle += 0.2;
    const legSway = Math.sin(agent.walkCycle) * 0.4; // +/- angle

    // Construct matrices for instances
    _position.copy(agent.pos);
    _rotation.setFromAxisAngle(new THREE.Vector3(0,0,1), agent.angle);
    _matrix.compose(_position, _rotation, _scale);

    // Body parts matrices relative to base matrix
    const _tMatrix = new THREE.Matrix4();

    // Body
    _tMatrix.makeTranslation(0, 0, 1.1);
    _tMatrix.premultiply(_matrix);
    this.instBody.setMatrixAt(i, _tMatrix);
    this.instBody.setColorAt(i, agent.shirtColor);

    // Head
    _tMatrix.makeTranslation(0, 0, 1.6);
    _tMatrix.premultiply(_matrix);
    this.instHead.setMatrixAt(i, _tMatrix);
    this.instHead.setColorAt(i, agent.skinColor);

    // Legs: They rotate around X
    const leftRotation = new THREE.Matrix4().makeRotationX(legSway);
    _tMatrix.makeTranslation(-0.08, 0, 0.4); // rest pose relative to body center
    _tMatrix.multiply(leftRotation);
    _tMatrix.premultiply(_matrix);
    this.instLeftLeg.setMatrixAt(i, _tMatrix);
    this.instLeftLeg.setColorAt(i, agent.pantColor);

    const rightRotation = new THREE.Matrix4().makeRotationX(-legSway);
    _tMatrix.makeTranslation(0.08, 0, 0.4);
    _tMatrix.multiply(rightRotation);
    _tMatrix.premultiply(_matrix);
    this.instRightLeg.setMatrixAt(i, _tMatrix);
    this.instRightLeg.setColorAt(i, agent.pantColor);
  }

  this.instHead.instanceMatrix.needsUpdate = true;
  this.instBody.instanceMatrix.needsUpdate = true;
  this.instLeftLeg.instanceMatrix.needsUpdate = true;
  this.instRightLeg.instanceMatrix.needsUpdate = true;
  if (this.instHead.instanceColor) this.instHead.instanceColor.needsUpdate = true;
  if (this.instBody.instanceColor) this.instBody.instanceColor.needsUpdate = true;
  if (this.instLeftLeg.instanceColor) this.instLeftLeg.instanceColor.needsUpdate = true;
  if (this.instRightLeg.instanceColor) this.instRightLeg.instanceColor.needsUpdate = true;
};
