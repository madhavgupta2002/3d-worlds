import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HALF_X, HALF_Z, centerX, height, mulberry32, buildTerrainGeometry } from './terrain.js';
import { createSky, SUN_DIR, HORIZON } from './sky.js';
import { createWater, FOG_DENSITY } from './water.js';
import { paintTerrain, paintRock, proceduralRocks, createForest, createGrass, swayUniform } from './forest.js';

const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(HORIZON, FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2500);
camera.layers.enable(1);                       // layer 1 = trees/grass (skipped by the water depth pre-pass)
camera.position.set(centerX(100) + 60, 95, 235);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(centerX(-20), 20, -20);
controls.enablePan = true;
controls.screenSpacePanning = false;           // pan along the ground plane
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.minDistance = 2;
controls.maxDistance = 900;
controls.enableDamping = true;
controls.zoomToCursor = true;

// lights; the shadow frustum follows the orbit target
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x4a5a35, 0.9));
const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.08;
scene.add(sun, sun.target);

const sky = createSky();
scene.add(sky);

// colour/depth pre-pass so the water can fade at shores and refract the bed
const rt = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
const water = createWater(rt, camera);
scene.add(water);

function grainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256), rnd = mulberry32(3);
  for (let i = 0; i < 256 * 256; i++) { const v = 175 + rnd() * 80; img.data.set([v, v, v, 255], i * 4); }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: grainTexture() });
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

async function build() {
  let terrain, rocks, source = 'procedural fallback';
  try {
    const gltf = await new GLTFLoader().loadAsync(import.meta.env.BASE_URL + 'creek.glb');
    rocks = new THREE.Group();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (o.name.startsWith('Terrain')) terrain = new THREE.Mesh(g, terrainMat);
      else if (o.name.startsWith('Rock')) { paintRock(g, rocks.children.length); const r = new THREE.Mesh(g, rockMat); r.castShadow = r.receiveShadow = true; rocks.add(r); }
    });
    if (!terrain) throw new Error('no Terrain mesh in GLB');
    source = 'Blender creek.glb';
  } catch {
    terrain = new THREE.Mesh(buildTerrainGeometry(), terrainMat);
    rocks = proceduralRocks(rockMat);
  }
  hud.textContent = 'planting forest…';
  await new Promise((r) => setTimeout(r));
  paintTerrain(terrain.geometry);
  terrain.receiveShadow = true;
  const forest = createForest();
  scene.add(terrain, rocks, forest, createGrass());
  hud.textContent = `terrain: ${source} · ${forest.userData.count.toLocaleString()} trees · drag: orbit · right-drag / WASD: pan · scroll: zoom · shift: fast`;
}

function resize() {
  const w = innerWidth, h = innerHeight, pr = renderer.getPixelRatio();
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const bw = Math.floor(w * pr), bh = Math.floor(h * pr);
  rt.setSize(bw, bh);
  rt.depthTexture.image.width = bw; rt.depthTexture.image.height = bh;
  water.material.uniforms.uRes.value.set(bw, bh);
}
addEventListener('resize', resize);
resize();

// keyboard panning (WASD / arrows), speed scales with zoom distance
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  swayUniform.value = t;
  water.material.uniforms.uTime.value = t;
  sky.material.uniforms.uTime.value = t;

  const k = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0);
  const f = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'), r = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
  if (f || r) {
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    right.crossVectors(fwd, UP);
    const speed = Math.max(4, camera.position.distanceTo(controls.target)) * 0.9 * dt * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1);
    move.set(0, 0, 0).addScaledVector(fwd, f * speed).addScaledVector(right, r * speed);
    controls.target.add(move); camera.position.add(move);
  }
  // keep the target inside the world and riding the ground
  const tg = controls.target;
  const cx = THREE.MathUtils.clamp(tg.x, -HALF_X + 10, HALF_X - 10) - tg.x, cz = THREE.MathUtils.clamp(tg.z, -HALF_Z + 10, HALF_Z - 10) - tg.z;
  tg.x += cx; tg.z += cz; camera.position.x += cx; camera.position.z += cz;
  const dy = (height(tg.x, tg.z) + 1 - tg.y) * Math.min(1, dt * 3);
  tg.y += dy; camera.position.y += dy;

  controls.update();
  camera.position.y = Math.max(camera.position.y, height(camera.position.x, camera.position.z) + 1);
  sky.position.copy(camera.position);

  sun.target.position.copy(tg).round();
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 200);
  sun.target.updateMatrixWorld();

  water.visible = false;
  camera.layers.disable(1);
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  camera.layers.enable(1);
  water.visible = true;
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
});

build().catch((e) => { hud.textContent = 'error: ' + e.message; console.error(e); });
