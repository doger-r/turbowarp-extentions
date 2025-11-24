(function(Scratch) {
    'use strict';

    const EXTENSION_ID = 'penguin3d';
    const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
    const CANNON_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/cannon.js/0.6.2/cannon.min.js';

    class Peng3D {
        constructor() {
            // Core
            this.scene = null;
            this.activeCamera = null;
            this.renderer = null;
            
            // Containers
            this.objects = {}; 
            this.physicsBodies = {}; 
            this.objectPhysData = {}; 
            
            // Resources
            this._sharedGeometries = {};
            this._sharedMaterials = {}; 
            this._defaultPhysMaterial = null; 
            
            // Physics
            this.world = null;
            this.bodyToName = new Map();
            this.raycaster = null;
            
            // Physics Time Step Tracking
            this._lastPhysTime = 0;

            // Render State
            this.renderPending = false;
            this.config = {
                shadows: 1,
                renderDistance: 100
            };

            // Optimization: Reusable temporaries
            this._vec3 = null; 
            this._euler = null;
            this._quat = null;
            this._cVec = null;
            this._cQuat = null;

            // Helper / Targeting
            this.targetSpriteName = '';
            this.helperCanvas = null;
            this.helperCtx = null;

            // Loading State
            this.loaded = false;
            this._loadPromise = null;
            
            this._loadDependencies();
        }

        _loadDependencies() {
            if (this._loadPromise) return this._loadPromise;

            this._loadPromise = new Promise((resolve, reject) => {
                if (window.THREE && window.CANNON) {
                    this.loaded = true;
                    this._ensureInit();
                    resolve();
                    return;
                }

                const scriptThree = document.createElement('script');
                scriptThree.src = THREE_CDN;
                scriptThree.onload = () => {
                    const scriptCannon = document.createElement('script');
                    scriptCannon.src = CANNON_CDN;
                    scriptCannon.onload = () => {
                        this.loaded = true;
                        this._ensureInit();
                        resolve();
                    };
                    scriptCannon.onerror = () => reject(new Error("Failed to load Cannon"));
                    document.head.appendChild(scriptCannon);
                };
                scriptThree.onerror = () => reject(new Error("Failed to load Three"));
                document.head.appendChild(scriptThree);
            });
            return this._loadPromise;
        }

        _check() {
            return this._loadPromise;
        }

        _ensureInit() {
            if (this.renderer) return;

            // 1. Init Three.js
            this.renderer = new THREE.WebGLRenderer({ 
                alpha: true, 
                antialias: true,
                preserveDrawingBuffer: true,
                powerPreference: "high-performance"
            });
            this.renderer.setClearColor(0x000000, 0); 
            this.renderer.shadowMap.enabled = (this.config.shadows === 1);
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.setSize(480, 360); 

            // 2. Resources (High Quality)
            this._initSharedResources();

            // 3. Init Physics
            this.world = new CANNON.World();
            // UPDATED: Default gravity set to Earth standard -9.8
            this.world.gravity.set(0, -9.8, 0);
            this.world.broadphase = new CANNON.NaiveBroadphase();
            this.world.solver.iterations = 10; 
            
            this._defaultPhysMaterial = new CANNON.Material("default");
            const defaultContact = new CANNON.ContactMaterial(this._defaultPhysMaterial, this._defaultPhysMaterial, {
                friction: 0.3,
                restitution: 0.1 
            });
            this.world.addContactMaterial(defaultContact);

            // 4. Init Scene
            this.scene = new THREE.Scene();
            this.ambientLight = new THREE.AmbientLight(0xffffff, 0); 
            this.scene.add(this.ambientLight);
            
            // 5. Init Helpers
            this.raycaster = new THREE.Raycaster();
            this._vec3 = new THREE.Vector3();
            this._euler = new THREE.Euler();
            this._quat = new THREE.Quaternion();
            this._cVec = new CANNON.Vec3();
            this._cQuat = new CANNON.Quaternion();
            
            this.helperCanvas = document.createElement('canvas');
            this.helperCanvas.width = 480;
            this.helperCanvas.height = 360;
            this.helperCtx = this.helperCanvas.getContext('2d', { willReadFrequently: true });
        }

        _initSharedResources() {
            const stdMat = new THREE.MeshStandardMaterial({ 
                color: 0xffffff, 
                roughness: 0.5, 
                metalness: 0.5 
            });
            this._sharedMaterials.default = stdMat;

            this._sharedGeometries = {
                'Cube': new THREE.BoxGeometry(1, 1, 1),
                'Sphere': new THREE.SphereGeometry(0.6, 32, 32),
                'Cone': new THREE.ConeGeometry(0.5, 1, 32),
                'Cylinder': new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
                'Donut': new THREE.TorusGeometry(0.5, 0.2, 32, 64)
            };
            this._sharedGeometries['Donut'].rotateX(-Math.PI / 2);
        }

        // --------------------------------------------------------------------------
        // Render Logic
        // --------------------------------------------------------------------------

        _requestRender() {
            if (this.renderPending) return;
            this.renderPending = true;
            requestAnimationFrame(() => {
                this._render();
                this.renderPending = false;
            });
        }

        _render() {
            if (!this.renderer || !this.scene) return;

            let logicW = 480, logicH = 360;
            if (Scratch.vm && Scratch.vm.runtime) {
                logicW = Scratch.vm.runtime.stageWidth;
                logicH = Scratch.vm.runtime.stageHeight;
            }

            const dpr = window.devicePixelRatio || 1;
            const scale = Math.max(dpr, 2); 
            const canvas = this.renderer.domElement;
            const width = Math.floor(logicW * scale);
            const height = Math.floor(logicH * scale);

            if (canvas.width !== width || canvas.height !== height) {
                this.renderer.setSize(logicW, logicH, false);
                this.renderer.setPixelRatio(scale);
                if (this.helperCanvas) {
                    this.helperCanvas.width = width;
                    this.helperCanvas.height = height;
                }
            }

            if (this.activeCamera && this.activeCamera.isCamera) {
                const aspect = logicW / logicH;
                if (this.activeCamera.aspect !== aspect) {
                    this.activeCamera.aspect = aspect;
                    this.activeCamera.updateProjectionMatrix();
                }
                this.renderer.render(this.scene, this.activeCamera);
            } else {
                this.renderer.clear();
            }

            this._handleSpriteTargeting(scale);
        }

        _handleSpriteTargeting(scale) {
            if (!this.targetSpriteName || !Scratch.vm) return;
            const target = Scratch.vm.runtime.getSpriteTargetByName(this.targetSpriteName);
            if (!target) return;
            const costume = target.sprite.costumes[target.currentCostume];
            if (!costume) return;

            const ctx = this.helperCtx;
            const cvs = this.helperCanvas;
            const dom = this.renderer.domElement;

            if (ctx) {
                ctx.clearRect(0, 0, cvs.width, cvs.height);
                ctx.drawImage(dom, 0, 0);
                Scratch.vm.renderer.updateBitmapSkin(costume.skinId, cvs, scale);
                target.emit('TARGET_WAS_DRAGGED'); 
            }
        }

        // --------------------------------------------------------------------------
        // Object Management
        // --------------------------------------------------------------------------

        _disposeObject(obj, name) {
            if (!obj) return;
            this.scene.remove(obj);
            if (obj.parent) obj.parent.remove(obj);

            const isSharedGeo = Object.values(this._sharedGeometries).includes(obj.geometry);
            if (!isSharedGeo && obj.geometry) obj.geometry.dispose();

            if (obj.material && obj.material !== this._sharedMaterials.default) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }

            if (this.physicsBodies[name]) {
                this.world.removeBody(this.physicsBodies[name]);
                this.bodyToName.delete(this.physicsBodies[name].id);
                delete this.physicsBodies[name];
                delete this.objectPhysData[name];
            }
            delete this.objects[name];
        }

        createObject(args) {
            if (!this.loaded) return this._check().then(() => this.createObject(args));
            
            const type = args.TYPE;
            const name = args.NAME;

            if (this.objects[name]) this._disposeObject(this.objects[name], name);

            let obj;
            if (this._sharedGeometries[type]) {
                obj = new THREE.Mesh(this._sharedGeometries[type], this._sharedMaterials.default);
            } else if (type === 'Light') {
                obj = new THREE.PointLight(0xffffff, 1, 100);
                obj.castShadow = (this.config.shadows === 1); 
                obj.shadow.bias = -0.0001;
                obj.shadow.mapSize.set(1024, 1024);
            } else if (type === 'Camera') {
                obj = new THREE.PerspectiveCamera(75, 480/360, 0.1, this.config.renderDistance);
            } else {
                obj = new THREE.Mesh(this._sharedGeometries['Cube'], this._sharedMaterials.default);
            }

            if (obj.isMesh) {
                obj.castShadow = obj.receiveShadow = (this.config.shadows === 1);
            }

            obj.name = name;
            obj.userData.type = type;
            this.scene.add(obj);
            this.objects[name] = obj;
            this._requestRender();
        }

        deleteObject(args) {
            if (!this.loaded) return this._check().then(() => this.deleteObject(args));
            this._disposeObject(this.objects[args.NAME], args.NAME);
            this._requestRender();
        }

        deleteAllObjects() {
            if (!this.loaded) return this._check().then(() => this.deleteAllObjects());
            Object.keys(this.objects).forEach(name => this._disposeObject(this.objects[name], name));
            this.activeCamera = null;
            this.renderer.clear();
            // Reset physics timer so next start doesn't have huge delta time
            this._lastPhysTime = 0;
            this._requestRender();
        }

        // --------------------------------------------------------------------------
        // Transforms
        // --------------------------------------------------------------------------

        _updatePhysicsTransform(name) {
            const body = this.physicsBodies[name];
            const obj = this.objects[name];
            if (body && obj) {
                body.position.set(obj.position.x, obj.position.y, obj.position.z);
                body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
                body.velocity.set(0,0,0);
                body.angularVelocity.set(0,0,0);
                body.wakeUp();
            }
        }

        setPos(args) {
            if (!this.loaded) return this._check().then(() => this.setPos(args));
            const obj = this.objects[args.NAME];
            if (!obj) return;
            obj.position.set(Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y), Scratch.Cast.toNumber(args.Z));
            this._updatePhysicsTransform(args.NAME);
            this._requestRender();
        }

        changePosition(args) {
            if (!this.loaded) return this._check().then(() => this.changePosition(args));
            const obj = this.objects[args.NAME];
            if (!obj) return;
            obj.position.x += Scratch.Cast.toNumber(args.X);
            obj.position.y += Scratch.Cast.toNumber(args.Y);
            obj.position.z += Scratch.Cast.toNumber(args.Z);
            this._updatePhysicsTransform(args.NAME);
            this._requestRender();
        }

        moveObject(args) {
            if (!this.loaded) return this._check().then(() => this.moveObject(args));
            const obj = this.objects[args.NAME];
            if (!obj) return;
            this._vec3.set(Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y), -Scratch.Cast.toNumber(args.Z));
            this._vec3.applyQuaternion(obj.quaternion);
            obj.position.add(this._vec3);
            this._updatePhysicsTransform(args.NAME);
            this._requestRender();
        }

        setRot(args) {
            if (!this.loaded) return this._check().then(() => this.setRot(args));
            const obj = this.objects[args.NAME];
            if (!obj) return;
            const d2r = Math.PI / 180;
            obj.rotation.set(
                Scratch.Cast.toNumber(args.X) * d2r,
                Scratch.Cast.toNumber(args.Y) * d2r,
                Scratch.Cast.toNumber(args.Z) * d2r
            );
            this._updatePhysicsTransform(args.NAME);
            this._requestRender();
        }

        changeRotation(args) {
            if (!this.loaded) return this._check().then(() => this.changeRotation(args));
            const obj = this.objects[args.NAME];
            if (!obj) return;
            const d2r = Math.PI / 180;
            this._euler.setFromQuaternion(obj.quaternion);
            this._euler.x += Scratch.Cast.toNumber(args.X) * d2r;
            this._euler.y += Scratch.Cast.toNumber(args.Y) * d2r;
            this._euler.z += Scratch.Cast.toNumber(args.Z) * d2r;
            obj.quaternion.setFromEuler(this._euler);
            this._updatePhysicsTransform(args.NAME);
            this._requestRender();
        }

        setRotYawPitch(args) {
            if (!this.loaded) return this._check().then(() => this.setRotYawPitch(args));
            const obj = this.objects[args.NAME];
            if (!obj) return;
            const d2r = Math.PI / 180;
            this._euler.set(
                Scratch.Cast.toNumber(args.PITCH) * d2r,
                -Scratch.Cast.toNumber(args.YAW) * d2r,
                0, 'YXZ'
            );
            obj.quaternion.setFromEuler(this._euler);
            this._updatePhysicsTransform(args.NAME);
            this._requestRender();
        }

        lookAtObject(args) {
            if (!this.loaded) return this._check().then(() => this.lookAtObject(args));
            const obj = this.objects[args.NAME];
            const target = this.objects[args.TARGET];
            if (!obj || !target) return;
            obj.lookAt(target.position);
            obj.rotateY(Math.PI);
            this._updatePhysicsTransform(args.NAME);
            this._requestRender();
        }

        getLookingAt(args) {
            if (!this.loaded) return this._check().then(() => this.getLookingAt(args));
            const obj = this.objects[args.NAME];
            if (!obj) return "";
            if (!this.raycaster) return "";

            // -Z is the default forward direction for objects in this system
            this._vec3.set(0, 0, -1);
            this._vec3.applyQuaternion(obj.quaternion);

            this.raycaster.set(obj.position, this._vec3.normalize());
            this.raycaster.near = 0.1;
            this.raycaster.far = this.config.renderDistance;

            // Get all mesh objects except the source
            const targets = [];
            for (const key in this.objects) {
                const item = this.objects[key];
                if (item !== obj && item.isMesh) {
                    targets.push(item);
                }
            }

            const intersects = this.raycaster.intersectObjects(targets, false);
            if (intersects.length > 0) {
                return intersects[0].object.name;
            }
            return "";
        }

        setScale(args) {
            if (!this.loaded) return this._check().then(() => this.setScale(args));
            const obj = this.objects[args.NAME];
            if (!obj) return;
            obj.scale.set(Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y), Scratch.Cast.toNumber(args.Z));
            this._requestRender();
        }

        // --------------------------------------------------------------------------
        // Appearance
        // --------------------------------------------------------------------------

        setColor(args) {
            if (!this.loaded) return this._check().then(() => this.setColor(args));
            const obj = this.objects[args.NAME];
            if (!obj) return;
            if (obj.isMesh) {
                if (obj.material === this._sharedMaterials.default) obj.material = obj.material.clone();
                obj.material.color.set(args.COLOR);
            } else if (obj.isLight) {
                obj.color.set(args.COLOR);
            }
            this._requestRender();
        }

        setTexture(args) {
            if (!this.loaded) return this._check().then(() => this.setTexture(args));
            const obj = this.objects[args.NAME];
            if (!obj || !obj.isMesh) return;
            if (obj.material === this._sharedMaterials.default) obj.material = obj.material.clone();
            
            new THREE.TextureLoader().load(Scratch.Cast.toString(args.URL), (tex) => {
                if (obj.material) {
                    obj.material.map = tex;
                    obj.material.needsUpdate = true;
                    this._requestRender();
                }
            });
        }

        // --------------------------------------------------------------------------
        // Physics
        // --------------------------------------------------------------------------

        enablePhysics(args) {
            if (!this.loaded) return this._check().then(() => this.enablePhysics(args));
            const name = args.NAME;
            const obj = this.objects[name];
            if (!obj || !obj.isMesh) return;

            if (this.physicsBodies[name]) {
                this.world.removeBody(this.physicsBodies[name]);
                this.bodyToName.delete(this.physicsBodies[name].id);
            }

            const s = obj.scale;
            const type = obj.userData.type || 'Cube';
            
            const body = new CANNON.Body({
                mass: 1,
                material: this._defaultPhysMaterial,
                linearDamping: 0.01,
                angularDamping: 0.01,
                position: new CANNON.Vec3(obj.position.x, obj.position.y, obj.position.z)
            });

            let shape;
            if (type === 'Sphere') {
                shape = new CANNON.Sphere(0.6 * s.x);
                body.addShape(shape);
            } else if (type === 'Cylinder' || type === 'Cone') {
                const rTop = (type === 'Cone') ? 0.01 : 0.5 * s.x; 
                shape = new CANNON.Cylinder(rTop, 0.5 * s.x, 1 * s.y, 32);
                const q = new CANNON.Quaternion();
                q.setFromAxisAngle(new CANNON.Vec3(1,0,0), -Math.PI/2);
                body.addShape(shape, new CANNON.Vec3(0,0,0), q);
            } else if (type === 'Donut') {
                const R = 0.5 * s.x;
                const r = 0.2 * s.x;
                const segments = 16; 
                for (let i = 0; i < segments; i++) {
                    const ang = (i/segments) * Math.PI * 2;
                    body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(Math.cos(ang)*R, Math.sin(ang)*R, 0));
                }
            } else {
                shape = new CANNON.Box(new CANNON.Vec3(0.5*s.x, 0.5*s.y, 0.5*s.z));
                body.addShape(shape);
            }

            body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
            body.name = name;
            
            this.world.addBody(body);
            this.physicsBodies[name] = body;
            this.bodyToName.set(body.id, name);
            this.objectPhysData[name] = { enabled: true, mass: 1, fixed: false, friction: 0.3, bounciness: 0.3 };
        }

        stepPhysics() {
            if (!this.loaded) return this._check().then(() => this.stepPhysics());
            if (!this.world) return;
            
            // Automatic Delta Time Calculation
            const now = performance.now();
            if (this._lastPhysTime === 0) {
                this._lastPhysTime = now;
                // Skip the very first step to establish a time baseline, 
                // preventing huge jumps if loaded long after page start.
                return;
            }

            // Calculate seconds elapsed since last frame
            const dt = (now - this._lastPhysTime) / 1000;
            this._lastPhysTime = now;

            // Step the world
            // 1st arg: Fixed time step (ideal physics tick)
            // 2nd arg: Time elapsed since last call
            // 3rd arg: Max sub-steps to catch up (prevents spiral of death)
            this.world.step(1/60, dt, 10);

            const bodies = this.physicsBodies;
            const objs = this.objects;
            
            for (const name in bodies) {
                const b = bodies[name];
                const m = objs[name];
                if (m) {
                    m.position.set(b.position.x, b.position.y, b.position.z);
                    m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
                }
            }
            this._requestRender();
        }

        pushObject(args) {
            if (!this.loaded) return this._check().then(() => this.pushObject(args));
            const body = this.physicsBodies[args.NAME];
            if (!body) return;
            body.wakeUp();
            this._cVec.set(Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y), Scratch.Cast.toNumber(args.Z));
            body.applyImpulse(this._cVec, body.position);
        }

        setPhysProp(args) {
            if (!this.loaded) return this._check().then(() => this.setPhysProp(args));
            const body = this.physicsBodies[args.NAME];
            if (!body) return;
            const val = Scratch.Cast.toNumber(args.VAL);
            const pData = this.objectPhysData[args.NAME];

            if (args.PROP === 'fixed') {
                pData.fixed = (val === 1);
                body.mass = pData.fixed ? 0 : pData.mass;
                body.type = pData.fixed ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
                body.updateMassProperties();
                body.velocity.set(0,0,0);
            } else {
                if (args.PROP === 'friction') pData.friction = val;
                if (args.PROP === 'bounciness') pData.bounciness = val;

                if (body.material === this._defaultPhysMaterial) {
                    body.material = new CANNON.Material("mat_" + args.NAME);
                }
                
                let cm = this.world.getContactMaterial(body.material, this._defaultPhysMaterial);
                if (!cm) {
                    cm = new CANNON.ContactMaterial(body.material, this._defaultPhysMaterial, { friction: pData.friction, restitution: pData.bounciness });
                    this.world.addContactMaterial(cm);
                } else {
                    cm.friction = pData.friction;
                    cm.restitution = pData.bounciness;
                }
            }
            body.wakeUp();
        }

        // --------------------------------------------------------------------------
        // Getters / Reporters
        // --------------------------------------------------------------------------

        getPosition(args) {
            if (!this.loaded) return this._check().then(() => this.getPosition(args));
            const obj = this.objects[args.NAME];
            if (!obj) return "[]";
            return JSON.stringify([obj.position.x, obj.position.y, obj.position.z]);
        }

        // NEW BLOCK: Distance
        getDistanceBetween(args) {
            if (!this.loaded) return this._check().then(() => this.getDistanceBetween(args));
            const obj1 = this.objects[args.OBJ1];
            const obj2 = this.objects[args.OBJ2];
            
            // Return 0 if either object doesn't exist to prevent crashes
            if (!obj1 || !obj2) return 0;
            
            return obj1.position.distanceTo(obj2.position);
        }

        getRotation(args) {
            if (!this.loaded) return this._check().then(() => this.getRotation(args));
            const obj = this.objects[args.NAME];
            if (!obj) return "[]";
            const r2d = 180 / Math.PI;
            this._euler.setFromQuaternion(obj.quaternion);
            return JSON.stringify([this._euler.x * r2d, this._euler.y * r2d, this._euler.z * r2d]);
        }

        getYawPitch(args) {
            if (!this.loaded) return this._check().then(() => this.getYawPitch(args));
            const obj = this.objects[args.NAME];
            if (!obj) return "[]";
            const r2d = 180 / Math.PI;
            this._euler.setFromQuaternion(obj.quaternion, 'YXZ');
            return JSON.stringify([-this._euler.y * r2d, this._euler.x * r2d]);
        }

        getScale(args) {
            if (!this.loaded) return this._check().then(() => this.getScale(args));
            const obj = this.objects[args.NAME];
            if (!obj) return "[]";
            return JSON.stringify([obj.scale.x, obj.scale.y, obj.scale.z]);
        }

        getTouching(args) {
            if (!this.loaded) return this._check().then(() => this.getTouching(args));
            if (!this.world || !this.physicsBodies[args.NAME]) return "[]";
            const target = this.physicsBodies[args.NAME];
            const touching = new Set();
            const contacts = this.world.contacts;
            for (let i = 0; i < contacts.length; i++) {
                const c = contacts[i];
                let other = null;
                if (c.bi === target) other = c.bj;
                else if (c.bj === target) other = c.bi;
                if (other) {
                    const name = this.bodyToName.get(other.id);
                    if (name) touching.add(name);
                }
            }
            return JSON.stringify(Array.from(touching));
        }

        // --------------------------------------------------------------------------
        // Metadata
        // --------------------------------------------------------------------------

        getInfo() {
            return {
                id: EXTENSION_ID,
                name: 'Peng3D',
                color1: '#4a90e2',
                color2: '#357abd',
                blocks: [
                    { opcode: 'areEnginesLoaded', blockType: Scratch.BlockType.BOOLEAN, text: 'are 3D engines loaded?', disableMonitor: true },
                    // NEW BLOCK: Hat
                    { opcode: 'whenEnginesLoaded', blockType: Scratch.BlockType.HAT, text: 'when 3D engines loaded' },
                    '---',
                    { opcode: 'setQualitySetting', blockType: Scratch.BlockType.COMMAND, text: 'set [SETTING] to [VALUE]', arguments: { SETTING: { type: Scratch.ArgumentType.STRING, menu: 'qualityMenu', defaultValue: 'renderDistance' }, VALUE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 } } },
                    '---',
                    { opcode: 'setTargetSprite', blockType: Scratch.BlockType.COMMAND, text: 'set targeted sprite to [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu', defaultValue: 'Sprite1' } } },
                    { opcode: 'getSnapshot', blockType: Scratch.BlockType.REPORTER, text: 'get 3D scene image (data URL)', disableMonitor: true },
                    '---',
                    { opcode: 'createObject', blockType: Scratch.BlockType.COMMAND, text: 'create [TYPE] named [NAME]', arguments: { TYPE: { type: Scratch.ArgumentType.STRING, menu: 'objTypes', defaultValue: 'Cube' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    { opcode: 'deleteObject', blockType: Scratch.BlockType.COMMAND, text: 'delete object [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    { opcode: 'deleteAllObjects', blockType: Scratch.BlockType.COMMAND, text: 'delete all objects' },
                    { opcode: 'groupObjects', blockType: Scratch.BlockType.COMMAND, text: 'group [CHILD] into [PARENT]', arguments: { CHILD: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object2' }, PARENT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    { opcode: 'ungroupObject', blockType: Scratch.BlockType.COMMAND, text: 'ungroup [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object2' } } },
                    '---',
                    { opcode: 'setPos', blockType: Scratch.BlockType.COMMAND, text: 'set [NAME] position to x:[X] y:[Y] z:[Z]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Z: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
                    { opcode: 'changePosition', blockType: Scratch.BlockType.COMMAND, text: 'move [NAME] by x:[X] y:[Y] z:[Z]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Z: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
                    { opcode: 'moveObject', blockType: Scratch.BlockType.COMMAND, text: 'move [NAME] by (local) x:[X] y:[Y] z:[Z]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Z: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
                    { opcode: 'getPosition', blockType: Scratch.BlockType.REPORTER, text: 'get [NAME] position array', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    // NEW BLOCK: Distance
                    { opcode: 'getDistanceBetween', blockType: Scratch.BlockType.REPORTER, text: 'distance from [OBJ1] to [OBJ2]', arguments: { OBJ1: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, OBJ2: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object2' } } },
                    '---',
                    { opcode: 'setRot', blockType: Scratch.BlockType.COMMAND, text: 'set [NAME] rotation to x:[X] y:[Y] z:[Z]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Z: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
                    { opcode: 'changeRotation', blockType: Scratch.BlockType.COMMAND, text: 'rotate [NAME] by x:[X] y:[Y] z:[Z]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Z: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
                    { opcode: 'setRotYawPitch', blockType: Scratch.BlockType.COMMAND, text: 'set [NAME] rotation to yaw:[YAW] pitch:[PITCH]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, YAW: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, PITCH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
                    { opcode: 'getRotation', blockType: Scratch.BlockType.REPORTER, text: 'get [NAME] rotation array', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    { opcode: 'getYawPitch', blockType: Scratch.BlockType.REPORTER, text: 'get [NAME] yaw/pitch array', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    { opcode: 'lookAtObject', blockType: Scratch.BlockType.COMMAND, text: 'make [NAME] look at [TARGET]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object2' } } },
                    { opcode: 'getLookingAt', blockType: Scratch.BlockType.REPORTER, text: 'get object [NAME] is looking at', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    '---',
                    { opcode: 'setScale', blockType: Scratch.BlockType.COMMAND, text: 'set [NAME] scale to x:[X] y:[Y] z:[Z]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }, Z: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
                    { opcode: 'getScale', blockType: Scratch.BlockType.REPORTER, text: 'get [NAME] scale array', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    '---',
                    { opcode: 'setColor', blockType: Scratch.BlockType.COMMAND, text: 'set [NAME] color to [COLOR]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: '#ffffff' } } },
                    { opcode: 'setTexture', blockType: Scratch.BlockType.COMMAND, text: 'set [NAME] texture [URL]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'data:image/png...' } } },
                    '---',
                    { opcode: 'setAmbientInfo', blockType: Scratch.BlockType.COMMAND, text: 'set ambient light intensity to [INTENSITY]', arguments: { INTENSITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
                    { opcode: 'setAmbientColor', blockType: Scratch.BlockType.COMMAND, text: 'set ambient light color to [COLOR]', arguments: { COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: '#ffffff' } } },
                    { opcode: 'setLightProp', blockType: Scratch.BlockType.COMMAND, text: 'set light [NAME] [PROP] to [VAL]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Light1' }, PROP: { type: Scratch.ArgumentType.STRING, menu: 'lightProps', defaultValue: 'intensity' }, VAL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
                    '---',
                    { opcode: 'enablePhysics', blockType: Scratch.BlockType.COMMAND, text: 'enable physics for [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    { opcode: 'stepPhysics', blockType: Scratch.BlockType.COMMAND, text: 'step physics simulation' },
                    // UPDATED: Default gravity set to -9.8
                    { opcode: 'setGravity', blockType: Scratch.BlockType.COMMAND, text: 'set gravity to [GRAV]', arguments: { GRAV: { type: Scratch.ArgumentType.NUMBER, defaultValue: -9.8 } } },
                    { opcode: 'setPhysProp', blockType: Scratch.BlockType.COMMAND, text: 'set [NAME] [PROP] to [VAL]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, PROP: { type: Scratch.ArgumentType.STRING, menu: 'physProps', defaultValue: 'bounciness' }, VAL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0.5 } } },
                    { opcode: 'pushObject', blockType: Scratch.BlockType.COMMAND, text: 'push [NAME] with force x:[X] y:[Y] z:[Z]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' }, X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }, Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }, Z: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
                    { opcode: 'getTouching', blockType: Scratch.BlockType.REPORTER, text: 'get objects touching [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Object1' } } },
                    '---',
                    { opcode: 'setCamera', blockType: Scratch.BlockType.COMMAND, text: 'set active camera to [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Cam1' } } },
                    { opcode: 'setFOV', blockType: Scratch.BlockType.COMMAND, text: 'set FOV of [NAME] to [FOV]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Cam1' }, FOV: { type: Scratch.ArgumentType.NUMBER, defaultValue: 75 } } },
                    '---',
                    { opcode: 'getSceneJSON', blockType: Scratch.BlockType.REPORTER, text: 'get scene as JSON' },
                    { opcode: 'loadSceneJSON', blockType: Scratch.BlockType.COMMAND, text: 'load scene from JSON [JSON]', arguments: { JSON: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } }
                ],
                menus: {
                    qualityMenu: { items: [{ text: 'Render Distance', value: 'renderDistance' }, { text: 'Shadows', value: 'shadows' }] },
                    objTypes: { acceptReporters: true, items: ['Cube', 'Sphere', 'Cone', 'Cylinder', 'Donut', 'Light', 'Camera'] },
                    lightProps: { items: [{ text: 'intensity', value: 'intensity' }, { text: 'distance', value: 'distance' }] },
                    physProps: { items: [{ text: 'bounciness', value: 'bounciness' }, { text: 'friction', value: 'friction' }, { text: 'fixed', value: 'fixed' }] },
                    spriteMenu: { acceptReporters: true, items: '_getSpriteMenu' }
                }
            };
        }

        areEnginesLoaded() { return this.loaded; }
        // NEW HAT BLOCK Logic
        whenEnginesLoaded() { return this.loaded; }

        _getSpriteMenu() {
            if (!Scratch.vm) return [['Sprite1', 'Sprite1']];
            const targets = Scratch.vm.runtime.targets;
            const menu = [];
            for (let i = 0; i < targets.length; i++) {
                if (targets[i].isOriginal && !targets[i].isStage) menu.push([targets[i].sprite.name, targets[i].sprite.name]);
            }
            return menu.length > 0 ? menu : [['Sprite1', 'Sprite1']];
        }

        setQualitySetting(args) {
            if (!this.loaded) return this._check().then(() => this.setQualitySetting(args));
            const val = Scratch.Cast.toNumber(args.VALUE);
            if (args.SETTING === 'shadows') {
                this.config.shadows = (val >= 1) ? 1 : 0;
                this.renderer.shadowMap.enabled = (this.config.shadows === 1);
                this.scene.traverse(c => { if(c.isMesh) c.castShadow = c.receiveShadow = (this.config.shadows === 1); });
                this.renderer.clear();
            } else if (args.SETTING === 'renderDistance') {
                this.config.renderDistance = Math.max(1, val);
                Object.values(this.objects).forEach(o => { if(o.isCamera) { o.far = this.config.renderDistance; o.updateProjectionMatrix(); } });
            }
            this._requestRender();
        }

        setTargetSprite(args) { 
            if (!this.loaded) return this._check().then(() => this.setTargetSprite(args));
            this.targetSpriteName = args.NAME; 
            this._requestRender(); 
        }
        
        getSnapshot() { 
            if (!this.loaded) return this._check().then(() => this.getSnapshot());
            this._requestRender(); 
            return this.renderer.domElement.toDataURL(); 
        }

        groupObjects(args) {
            if (!this.loaded) return this._check().then(() => this.groupObjects(args));
            const child = this.objects[args.CHILD], parent = this.objects[args.PARENT];
            if (child && parent && child !== parent) {
                if (this.physicsBodies[args.CHILD]) {
                    this.world.removeBody(this.physicsBodies[args.CHILD]);
                    delete this.physicsBodies[args.CHILD];
                }
                this.scene.remove(child);
                parent.add(child);
                child.position.set(0,0,0);
                this._requestRender();
            }
        }

        ungroupObject(args) {
            if (!this.loaded) return this._check().then(() => this.ungroupObject(args));
            const obj = this.objects[args.NAME];
            if (obj && obj.parent !== this.scene) {
                this.scene.attach(obj);
                this._requestRender();
            }
        }

        setAmbientInfo(args) { 
            if (!this.loaded) return this._check().then(() => this.setAmbientInfo(args));
            if (this.ambientLight) { this.ambientLight.intensity = Scratch.Cast.toNumber(args.INTENSITY); this._requestRender(); } 
        }

        setAmbientColor(args) { 
            if (!this.loaded) return this._check().then(() => this.setAmbientColor(args));
            if (this.ambientLight) { this.ambientLight.color.set(args.COLOR); this._requestRender(); } 
        }

        setLightProp(args) {
            if (!this.loaded) return this._check().then(() => this.setLightProp(args));
            const obj = this.objects[args.NAME];
            if (obj && obj.isLight) {
                const val = Scratch.Cast.toNumber(args.VAL);
                if (args.PROP === 'intensity') obj.intensity = val;
                if (args.PROP === 'distance') obj.distance = val;
                this._requestRender();
            }
        }

        setCamera(args) {
            if (!this.loaded) return this._check().then(() => this.setCamera(args));
            const obj = this.objects[args.NAME];
            if (obj && obj.isCamera) {
                this.activeCamera = obj;
                this.activeCamera.aspect = 480 / 360;
                this.activeCamera.updateProjectionMatrix();
                this._requestRender();
            }
        }

        setFOV(args) {
            if (!this.loaded) return this._check().then(() => this.setFOV(args));
            const obj = this.objects[args.NAME];
            if (obj && obj.isCamera && obj.isPerspectiveCamera) {
                obj.fov = Scratch.Cast.toNumber(args.FOV);
                obj.updateProjectionMatrix();
                this._requestRender();
            }
        }

        setGravity(args) { 
            if (!this.loaded) return this._check().then(() => this.setGravity(args));
            if (this.world) this.world.gravity.set(0, Scratch.Cast.toNumber(args.GRAV), 0); 
        }

        getSceneJSON() {
            if (!this.loaded) return this._check().then(() => this.getSceneJSON());
            const data = [];
            for (const key in this.objects) {
                const obj = this.objects[key];
                const entry = {
                    name: key, type: obj.userData.type || 'Cube',
                    pos: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                    rot: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                    scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                    color: obj.isMesh ? obj.material.color.getHex() : (obj.isLight ? obj.color.getHex() : 0xffffff)
                };
                if (obj.isLight) entry.lightProps = { intensity: obj.intensity, distance: obj.distance || 0 };
                if (this.objectPhysData[key]) entry.physics = this.objectPhysData[key];
                data.push(entry);
            }
            return JSON.stringify(data);
        }

        loadSceneJSON(args) {
            if (!this.loaded) return this._check().then(() => this.loadSceneJSON(args));
            try {
                const data = JSON.parse(args.JSON);
                this.deleteAllObjects();
                for (const item of data) {
                    this.createObject({ TYPE: item.type, NAME: item.name });
                    const obj = this.objects[item.name];
                    if (!obj) continue;
                    obj.position.set(item.pos.x, item.pos.y, item.pos.z);
                    obj.rotation.set(item.rot.x, item.rot.y, item.rot.z);
                    if (item.scale) obj.scale.set(item.scale.x, item.scale.y, item.scale.z);
                    if (item.color) this.setColor({ NAME: item.name, COLOR: '#' + item.color.toString(16).padStart(6,'0') });
                    if (item.physics && item.physics.enabled) {
                        this.enablePhysics({ NAME: item.name });
                        if (item.physics.fixed) this.setPhysProp({ NAME: item.name, PROP: 'fixed', VAL: 1 });
                    }
                }
                this._requestRender();
            } catch (e) { console.warn("Load Scene Failed", e); }
        }
    }

    Scratch.extensions.register(new Peng3D());
})(Scratch);
