/**
 * ModelLayer.js
 * 
 * A MapLibre custom layer that renders GLTF 3D models (people + trees)
 * using Three.js InstancedMesh. Hooks into CrowdSimulator for per-frame updates.
 * 
 * Files expected in: public/models/people.glb, public/models/tree.glb
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import maplibregl from 'maplibre-gl';

const stableRandom = (() => {
    let seed = 112233445;
    return () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
    };
})();

const MAX_PEOPLE = 2000;
const MAX_TREES  = 5000;
const PERSON_VISUAL_SCALE = 8.0; // How many times larger than real height (for visibility from above)
const TREE_VISUAL_SCALE   = 12.0;

export class ModelLayer {
    constructor(id) {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '3d';

        this.scene    = new THREE.Scene();
        this.camera   = new THREE.Camera();
        this.renderer = null;
        this.map      = null;

        // Lighting
        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
        this.sunLight.position.set(100, 100, 100);
        this.scene.add(this.sunLight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        this.scene.add(new THREE.HemisphereLight(0xffffbb, 0x080820, 0.5));

        this.peopleInstances = null;
        this.treeInstances   = null;
        this._peopleMat  = null;
        this._treeMat    = null;

        this.simTime = 7.75;
        this._dummy  = new THREE.Object3D();
        this._color  = new THREE.Color();

        this._loader = new GLTFLoader();
        this._loadPeople();
        this._loadTrees();
    }

    // ── GLTF Loading ──────────────────────────────────────────────────────────

    _loadPeople() {
        this._loader.load(
            '/models/people.glb',
            (gltf) => {
                const geo = this._extractMergedGeometry(gltf.scene);
                if (!geo) { console.warn('ModelLayer: people.glb mesh not found'); return; }

                // Normalize to standing height ≈ 1m (will be additionally scaled on render)
                this._normalizeGeometry(geo, 1.0);

                this._peopleMat = new THREE.MeshLambertMaterial({ vertexColors: true });
                this.peopleInstances = new THREE.InstancedMesh(geo, this._peopleMat, MAX_PEOPLE);
                this.peopleInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                this.peopleInstances.count = 0;
                this.scene.add(this.peopleInstances);

                console.log('✅ ModelLayer: people.glb loaded');
                if (this.map) this.map.triggerRepaint();
            },
            undefined,
            (err) => console.warn('ModelLayer: people.glb failed:', err?.message || err)
        );
    }

    _loadTrees() {
        this._buildProceduralTree();
        console.log('✅ ModelLayer: using procedural white triangle trees');
        if (this.map) this.map.triggerRepaint();
    }

    _buildProceduralTree() {
        const geo = new THREE.ConeGeometry(0.5, 1.0, 3);
        geo.translate(0, 0.5, 0);
        this._treeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.treeInstances = new THREE.InstancedMesh(geo, this._treeMat, MAX_TREES);
        this.treeInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        this.treeInstances.count = 0;
        this.scene.add(this.treeInstances);
    }

    _extractMergedGeometry(object) {
        const meshes = [];
        object.traverse(node => { if (node.isMesh) meshes.push(node); });
        if (meshes.length === 0) return null;

        // Use first mesh's geometry; merge would need BufferGeometryUtils but this works for single-mesh packs
        const geo = meshes[0].geometry.clone();
        // Try to apply mesh's own matrix
        meshes[0].updateWorldMatrix(true, false);
        geo.applyMatrix4(meshes[0].matrixWorld);
        return geo;
    }

    _normalizeGeometry(geo, targetHeight) {
        geo.computeBoundingBox();
        const box = geo.boundingBox;
        const height = box.max.y - box.min.y;
        if (height === 0) return;
        // Translate so bottom is at y=0
        geo.translate(
            -(box.min.x + box.max.x) / 2,
            -box.min.y,
            -(box.min.z + box.max.z) / 2
        );
        const s = targetHeight / height;
        geo.scale(s, s, s);
    }

    // ── MapLibre hooks ────────────────────────────────────────────────────────

    onAdd(map, gl) {
        this.map = map;
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true,
            alpha: true
        });
        this.renderer.autoClear = false;
        this.renderer.shadowMap.enabled = false;
    }

    render(gl, matrix) {
        if (!this.renderer) return;

        // Update sun lighting
        this._updateSun(this.simTime);

        // Apply MapLibre's projection matrix
        this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);

        this.renderer.resetState();
        this.renderer.clearDepth();
        this.renderer.render(this.scene, this.camera);

        this.map.triggerRepaint();
    }

    // ── Lighting ──────────────────────────────────────────────────────────────

    setSimTime(t) {
        this.simTime = t;
        this._updateSun(t);
    }

    _updateSun(hour) {
        const isDay  = hour >= 6 && hour <= 19;
        const curve  = Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI));
        const angle  = ((hour - 6) / 13) * Math.PI;
        const x      = Math.cos(angle);
        const z      = Math.sin(angle);
        this.sunLight.position.set(x * 500, z * 500, 300);
        this.sunLight.intensity = isDay ? Math.max(0.1, curve * 2.0) : 0.05;
        this.sunLight.color.setHex(
            !isDay            ? 0x1a1a4e :
            hour < 8          ? 0xffb347 :
            hour > 17         ? 0xff8c42 : 0xffffff
        );
    }

    // ── Agent position updates (called by CrowdSimulator) ─────────────────────

    updateAgents(agents) {
        if (!this.peopleInstances || !this.map) return;

        const center = this.map.getCenter();
        const meterScale = maplibregl.MercatorCoordinate
            .fromLngLat(center, 0)
            .meterInMercatorCoordinateUnits();

        // PERSON_VISUAL_SCALE * meterScale gives mercator size per meter of model height
        const agentScale = PERSON_VISUAL_SCALE * meterScale;

        // Only render agents that are MOVING (hide INSIDE agents from 3D view)
        const visibleAgents = agents.filter(a => a.state !== 'INSIDE');
        const count = Math.min(visibleAgents.length, MAX_PEOPLE);
        this.peopleInstances.count = count;

        for (let i = 0; i < count; i++) {
            const a = visibleAgents[i];
            const merc = maplibregl.MercatorCoordinate.fromLngLat({ lng: a.lng, lat: a.lat }, 0);

            this._dummy.position.set(merc.x, merc.y, merc.z);
            // Rotate to face direction of movement; Y is up in Three.js but MapLibre Z is up
            this._dummy.rotation.set(-Math.PI / 2, 0, a.angle || 0);
            this._dummy.scale.setScalar(agentScale);
            this._dummy.updateMatrix();
            this.peopleInstances.setMatrixAt(i, this._dummy.matrix);

            // Color by cohort
            this._color.set(a.color || '#ffffff');
            this.peopleInstances.setColorAt(i, this._color);
        }

        this.peopleInstances.instanceMatrix.needsUpdate = true;
        if (this.peopleInstances.instanceColor) {
            this.peopleInstances.instanceColor.needsUpdate = true;
        }
    }

    // ── Tree placement (called once after map loads) ───────────────────────────

    placeTrees(treePositions) {
        if (!this.treeInstances || !this.map) {
            // Defer until model is available
            this._pendingTreePositions = treePositions;
            return;
        }

        this._doPlaceTrees(treePositions);
    }

    _doPlaceTrees(treePositions) {
        if (!this.treeInstances || !this.map) return;

        const center = this.map.getCenter();
        const meterScale = maplibregl.MercatorCoordinate
            .fromLngLat(center, 0)
            .meterInMercatorCoordinateUnits();

        const treeScale = TREE_VISUAL_SCALE * meterScale;
        const count = Math.min(treePositions.length, MAX_TREES);
        this.treeInstances.count = count;

        for (let i = 0; i < count; i++) {
            const t = treePositions[i];
            const merc = maplibregl.MercatorCoordinate.fromLngLat({ lng: t.lng, lat: t.lat }, 0);

            this._dummy.position.set(merc.x, merc.y, merc.z);
            this._dummy.rotation.set(-Math.PI / 2, 0, stableRandom() * Math.PI * 2);
            this._dummy.scale.setScalar(treeScale * (0.8 + stableRandom() * 0.5));
            this._dummy.updateMatrix();
            this.treeInstances.setMatrixAt(i, this._dummy.matrix);
        }

        this.treeInstances.instanceMatrix.needsUpdate = true;
        if (this.map) this.map.triggerRepaint();
    }
}
