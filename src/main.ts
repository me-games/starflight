import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import "./style.css";

/* ============================================================
   Starflight — a playable v0 space flier (vanilla three.js).
   Goal: fly the ship through every glowing ring checkpoint.
   ============================================================ */

// ---- Config / tunables ----------------------------------------------------
const CONFIG = {
  cruiseSpeed: 70, // units/s
  boostSpeed: 150,
  slowSpeed: 30,
  speedSmoothing: 2.5, // how quickly speed eases toward target
  pitchRate: 1.5, // rad/s at full input
  yawRate: 1.1,
  rollRate: 2.2,
  autoBank: 0.6, // extra roll while yawing, for feel
  camFollow: 6, // position smoothing factor
  camTurn: 5, // orientation smoothing factor
  ringCount: 8,
  bloomStrength: 0.9,
  bloomRadius: 0.6,
  bloomThreshold: 0.0,
};

const BLOOM_LAYER = 1;

// ---- Renderer / scene / camera --------------------------------------------
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.5,
  20000,
);
camera.position.set(0, 6, 22);

// ---- Lighting -------------------------------------------------------------
const sunDir = new THREE.Vector3(-0.5, 0.35, 0.78).normalize();
const sunLight = new THREE.DirectionalLight(0xfff2d6, 2.6);
sunLight.position.copy(sunDir).multiplyScalar(1000);
scene.add(sunLight);
scene.add(new THREE.HemisphereLight(0x223a66, 0x05060c, 0.5));
scene.add(new THREE.AmbientLight(0x0a0e1a, 1.0));

// ---- Helpers --------------------------------------------------------------
function enableBloom(obj: THREE.Object3D) {
  obj.traverse((o) => o.layers.enable(BLOOM_LAYER));
}

// ---- Starfield (camera-relative deep space) -------------------------------
function makeStarTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.9)");
  g.addColorStop(0.5, "rgba(160,200,255,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStarfield(): THREE.Points {
  const count = 4500;
  const radius = 8000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = [
    new THREE.Color(0xffffff),
    new THREE.Color(0xbcd4ff),
    new THREE.Color(0xfff0c8),
    new THREE.Color(0xffd0c0),
  ];
  for (let i = 0; i < count; i++) {
    // even spread on a sphere shell
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.85 + Math.random() * 0.15);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    const col = palette[(Math.random() * palette.length) | 0]
      .clone()
      .multiplyScalar(0.6 + Math.random() * 0.6);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 34,
    map: makeStarTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  enableBloom(points);
  return points;
}
const starfield = makeStarfield();
scene.add(starfield);

// ---- Sun disc -------------------------------------------------------------
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(140, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xffe9b0 }),
);
sunMesh.position.copy(sunDir).multiplyScalar(6500);
enableBloom(sunMesh);
scene.add(sunMesh);

// soft sun glow halo
const sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(260, 32, 32),
  new THREE.MeshBasicMaterial({
    color: 0xffcf80,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
);
sunGlow.position.copy(sunMesh.position);
enableBloom(sunGlow);
scene.add(sunGlow);

// ---- Planet (with atmosphere shell) ---------------------------------------
function makePlanetTexture(): THREE.Texture {
  const w = 1024;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  // base gradient
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#7a4326");
  base.addColorStop(0.5, "#c08648");
  base.addColorStop(1, "#5a2f1c");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // banding + blobs for a gas-giant feel
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * h;
    const bandH = 6 + Math.random() * 26;
    ctx.fillStyle = `rgba(${200 + Math.random() * 55 | 0}, ${
      120 + Math.random() * 80 | 0
    }, ${60 + Math.random() * 50 | 0}, ${0.06 + Math.random() * 0.1})`;
    ctx.fillRect(0, y, w, bandH);
  }
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 4 + Math.random() * 30;
    ctx.fillStyle = `rgba(${230 * Math.random() | 0}, ${
      150 * Math.random() | 0
    }, ${90 * Math.random() | 0}, 0.05)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PLANET_POS = new THREE.Vector3(420, -160, -560);
const PLANET_RADIUS = 200;
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(PLANET_RADIUS, 96, 96),
  new THREE.MeshStandardMaterial({
    map: makePlanetTexture(),
    roughness: 0.95,
    metalness: 0.0,
  }),
);
planet.position.copy(PLANET_POS);
scene.add(planet);

// Atmosphere rim (Fresnel, additive) — on bloom layer so the selective-bloom
// pass keeps it intact instead of darkening it to a black shell.
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(PLANET_RADIUS * 1.06, 96, 96),
  new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      glowColor: { value: new THREE.Color(0x5aa9ff) },
      sunDir: { value: sunDir.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 glowColor;
      uniform vec3 sunDir;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        float rim = pow(1.0 - abs(dot(vNormalW, vViewDir)), 3.0);
        float lit = clamp(dot(-vNormalW, sunDir) * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(glowColor * rim * (0.4 + 0.9 * lit), rim);
      }
    `,
  }),
);
atmosphere.position.copy(PLANET_POS);
enableBloom(atmosphere);
scene.add(atmosphere);

// ---- Player ship ----------------------------------------------------------
function makeShip(): {
  group: THREE.Group;
  thruster: THREE.Mesh;
  thrusterGlow: THREE.Mesh;
} {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xc9d3dc,
    roughness: 0.4,
    metalness: 0.7,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x2b4a63,
    roughness: 0.5,
    metalness: 0.6,
  });

  // fuselage (nose points -Z)
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5.2, 16), hullMat);
  body.rotation.x = -Math.PI / 2;
  body.position.z = -0.4;
  group.add(body);

  const belly = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.9, 2.4, 6, 12),
    accentMat,
  );
  belly.rotation.x = Math.PI / 2;
  belly.position.set(0, -0.35, 0.6);
  group.add(belly);

  // wings
  const wingGeo = new THREE.BoxGeometry(5.6, 0.18, 1.8);
  const wings = new THREE.Mesh(wingGeo, hullMat);
  wings.position.set(0, -0.1, 0.7);
  group.add(wings);

  const finGeo = new THREE.BoxGeometry(0.18, 1.3, 1.3);
  const fin = new THREE.Mesh(finGeo, accentMat);
  fin.position.set(0, 0.5, 1.4);
  group.add(fin);

  // canopy
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x7fe9ff,
      roughness: 0.1,
      metalness: 0.2,
      emissive: 0x123040,
      emissiveIntensity: 0.4,
    }),
  );
  canopy.position.set(0, 0.35, -0.6);
  group.add(canopy);

  // engine thruster (glows — bloom layer)
  const thruster = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 3.2, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x66ddff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  thruster.rotation.x = Math.PI / 2; // flares out the back (+Z)
  thruster.position.set(0, -0.05, 2.6);
  enableBloom(thruster);
  group.add(thruster);

  const thrusterGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0x3fb6ff,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  thrusterGlow.position.set(0, -0.05, 1.9);
  enableBloom(thrusterGlow);
  group.add(thrusterGlow);

  return { group, thruster, thrusterGlow };
}
const { group: ship, thruster, thrusterGlow } = makeShip();
scene.add(ship);

// ---- Engine particle trail ------------------------------------------------
const TRAIL_COUNT = 120;
const trailPositions = new Float32Array(TRAIL_COUNT * 3);
const trailAlpha = new Float32Array(TRAIL_COUNT);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute(
  "position",
  new THREE.BufferAttribute(trailPositions, 3),
);
trailGeo.setAttribute("aAlpha", new THREE.BufferAttribute(trailAlpha, 1));
const trailMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uColor: { value: new THREE.Color(0x66d8ff) },
    uMap: { value: makeStarTexture() },
    uSize: { value: 90 },
  },
  vertexShader: /* glsl */ `
    attribute float aAlpha;
    varying float vAlpha;
    uniform float uSize;
    void main() {
      vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uSize * aAlpha / max(-mv.z, 1.0);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform sampler2D uMap;
    varying float vAlpha;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      gl_FragColor = vec4(uColor, 1.0) * tex * vAlpha;
    }
  `,
});
const trail = new THREE.Points(trailGeo, trailMat);
trail.frustumCulled = false;
enableBloom(trail);
scene.add(trail);
let trailHead = 0;
const trailEmitLocal = new THREE.Vector3(0, -0.05, 2.4);

// ---- Ring checkpoint course -----------------------------------------------
const RING_MAJOR = 14;
const RING_TUBE = 1.1;
type Ring = { mesh: THREE.Mesh; pos: THREE.Vector3; passed: boolean };

const coursePath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, -90),
  new THREE.Vector3(70, 22, -230),
  new THREE.Vector3(180, -8, -370),
  new THREE.Vector3(150, 48, -520),
  new THREE.Vector3(-20, 40, -640),
  new THREE.Vector3(-190, -10, -700),
  new THREE.Vector3(-280, 36, -560),
  new THREE.Vector3(-210, 8, -400),
]);

const rings: Ring[] = [];
function buildRings() {
  for (let i = 0; i < CONFIG.ringCount; i++) {
    const t = (i + 0.5) / CONFIG.ringCount;
    const pos = coursePath.getPointAt(t);
    const tangent = coursePath.getTangentAt(t);
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(RING_MAJOR, RING_TUBE, 16, 48),
      new THREE.MeshStandardMaterial({
        color: 0x0a2030,
        emissive: 0x16c8ff,
        emissiveIntensity: 1.2,
        roughness: 0.4,
        metalness: 0.3,
      }),
    );
    mesh.position.copy(pos);
    // orient ring so you fly through it along the path tangent
    mesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(
        new THREE.Vector3(),
        tangent,
        new THREE.Vector3(0, 1, 0),
      ),
    );
    enableBloom(mesh);
    scene.add(mesh);
    rings.push({ mesh, pos: pos.clone(), passed: false });
  }
}
buildRings();

const COLOR_ACTIVE = new THREE.Color(0x16c8ff);
const COLOR_PASSED = new THREE.Color(0x39ff9e);
const COLOR_FUTURE = new THREE.Color(0x9a6bff);

function styleRings(activeIndex: number) {
  rings.forEach((ring, i) => {
    const mat = ring.mesh.material as THREE.MeshStandardMaterial;
    if (ring.passed) {
      mat.emissive.copy(COLOR_PASSED);
      mat.emissiveIntensity = 0.5;
      ring.mesh.scale.setScalar(1);
    } else if (i === activeIndex) {
      mat.emissive.copy(COLOR_ACTIVE);
      mat.emissiveIntensity = 1.8;
    } else {
      mat.emissive.copy(COLOR_FUTURE);
      mat.emissiveIntensity = 0.7;
      ring.mesh.scale.setScalar(1);
    }
  });
}

// ---- Selective bloom pipeline ---------------------------------------------
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const savedMaterials = new Map<string, THREE.Material | THREE.Material[]>();

const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  CONFIG.bloomStrength,
  CONFIG.bloomRadius,
  CONFIG.bloomThreshold,
);

const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderPass);
bloomComposer.addPass(bloomPass);

const mixPass = new ShaderPass(
  new THREE.ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
      }
    `,
  }),
  "baseTexture",
);
mixPass.needsSwap = true;

const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderPass);
finalComposer.addPass(mixPass);
finalComposer.addPass(new OutputPass());

function darkenNonBloomed(obj: THREE.Object3D) {
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh && bloomLayer.test(mesh.layers) === false) {
    savedMaterials.set(mesh.uuid, mesh.material);
    mesh.material = darkMaterial;
  }
}
function restoreMaterial(obj: THREE.Object3D) {
  const mesh = obj as THREE.Mesh;
  const saved = savedMaterials.get(mesh.uuid);
  if (saved) {
    mesh.material = saved;
    savedMaterials.delete(mesh.uuid);
  }
}

// ---- Input ----------------------------------------------------------------
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
      e.code,
    )
  ) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
function axis(neg: string[], pos: string[]): number {
  let v = 0;
  if (neg.some((k) => keys.has(k))) v -= 1;
  if (pos.some((k) => keys.has(k))) v += 1;
  return v;
}

// ---- HUD / game state -----------------------------------------------------
const el = {
  rings: document.getElementById("rings")!,
  time: document.getElementById("time")!,
  speed: document.getElementById("speed")!,
  next: document.getElementById("next")!,
  overlay: document.getElementById("overlay")!,
  title: document.getElementById("overlay-title")!,
  body: document.getElementById("overlay-body")!,
  startBtn: document.getElementById("start-btn")!,
};

type Phase = "intro" | "playing" | "won";
let phase: Phase = "intro";
let score = 0;
let elapsed = 0;
let currentSpeed = CONFIG.cruiseSpeed;

function resetGame() {
  ship.position.set(0, 0, 0);
  ship.quaternion.identity();
  camera.position.set(0, 6, 22);
  camera.quaternion.identity();
  currentSpeed = CONFIG.cruiseSpeed;
  score = 0;
  elapsed = 0;
  rings.forEach((r) => (r.passed = false));
  styleRings(0);
  trailAlpha.fill(0);
}

function startGame() {
  resetGame();
  phase = "playing";
  el.overlay.classList.add("hidden");
}

function winGame() {
  phase = "won";
  el.title.textContent = "COURSE CLEAR";
  el.body.innerHTML = `All ${CONFIG.ringCount} rings in <b>${formatTime(
    elapsed,
  )}</b>.<br/>Think you can go faster?`;
  el.startBtn.textContent = "FLY AGAIN ▶";
  el.overlay.classList.remove("hidden");
}

el.startBtn.addEventListener("click", startGame);
window.addEventListener("keydown", (e) => {
  if (e.code === "Enter" && phase !== "playing") startGame();
  if (e.code === "KeyR" && phase === "playing") {
    el.title.textContent = "STARFLIGHT";
    el.body.textContent = "";
    startGame();
  }
});

function formatTime(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const dec = Math.floor((s * 10) % 10);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${dec}`;
}

// ---- Per-frame scratch objects (avoid per-frame allocations) --------------
const fwd = new THREE.Vector3();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const camOffset = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camUp = new THREE.Vector3();
const lookMat = new THREE.Matrix4();
const worldEmit = new THREE.Vector3();

function activeRingIndex(): number {
  for (let i = 0; i < rings.length; i++) if (!rings[i].passed) return i;
  return -1;
}

// ---- Update ---------------------------------------------------------------
function update(dt: number) {
  if (phase === "playing") {
    elapsed += dt;

    // --- flight input ---
    const pitch = axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]); // +1 climb
    const yaw = axis(["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]); // +1 left
    const roll = axis(["KeyE"], ["KeyQ"]);

    tmpEuler.set(
      pitch * CONFIG.pitchRate * dt,
      yaw * CONFIG.yawRate * dt,
      (roll + yaw * CONFIG.autoBank) * CONFIG.rollRate * dt,
      "XYZ",
    );
    tmpQuat.setFromEuler(tmpEuler);
    ship.quaternion.multiply(tmpQuat); // local-space rotation

    // --- throttle / speed ---
    let targetSpeed = CONFIG.cruiseSpeed;
    if (keys.has("ShiftLeft") || keys.has("ShiftRight"))
      targetSpeed = CONFIG.boostSpeed;
    if (keys.has("KeyX")) targetSpeed = CONFIG.slowSpeed;
    currentSpeed +=
      (targetSpeed - currentSpeed) *
      (1 - Math.exp(-CONFIG.speedSmoothing * dt));

    fwd.set(0, 0, -1).applyQuaternion(ship.quaternion);
    ship.position.addScaledVector(fwd, currentSpeed * dt);

    // --- ring checkpoint detection ---
    const ai = activeRingIndex();
    if (ai >= 0) {
      const ring = rings[ai];
      const d = ship.position.distanceTo(ring.pos);
      if (d < RING_MAJOR) {
        ring.passed = true;
        score++;
        styleRings(activeRingIndex());
        if (score >= CONFIG.ringCount) winGame();
      }
    }

    // --- engine visuals react to speed ---
    const t = (currentSpeed - CONFIG.slowSpeed) /
      (CONFIG.boostSpeed - CONFIG.slowSpeed);
    const pulse = 0.85 + 0.15 * Math.sin(elapsed * 30);
    thruster.scale.set(1, 1, (0.7 + t * 1.1) * pulse);
    (thruster.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.4 * t;
    thrusterGlow.scale.setScalar((0.8 + t * 0.7) * pulse);

    // --- emit trail particle ---
    worldEmit.copy(trailEmitLocal).applyMatrix4(ship.matrixWorld);
    trailPositions[trailHead * 3] = worldEmit.x;
    trailPositions[trailHead * 3 + 1] = worldEmit.y;
    trailPositions[trailHead * 3 + 2] = worldEmit.z;
    trailAlpha[trailHead] = 1;
    trailHead = (trailHead + 1) % TRAIL_COUNT;
  }

  // fade trail
  for (let i = 0; i < TRAIL_COUNT; i++) trailAlpha[i] *= 1 - 2.0 * dt;
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.aAlpha.needsUpdate = true;

  // keep deep-space stars centered on the player (no false parallax)
  starfield.position.copy(ship.position);

  // --- chase camera ---
  ship.updateMatrixWorld();
  camOffset.set(0, 5.2, 19).applyQuaternion(ship.quaternion).add(ship.position);
  camLook.set(0, 1.4, -34).applyQuaternion(ship.quaternion).add(ship.position);
  camUp.set(0, 1, 0).applyQuaternion(ship.quaternion);

  const posAlpha = 1 - Math.exp(-CONFIG.camFollow * dt);
  const rotAlpha = 1 - Math.exp(-CONFIG.camTurn * dt);
  camera.position.lerp(camOffset, posAlpha);
  lookMat.lookAt(camera.position, camLook, camUp);
  tmpQuat.setFromRotationMatrix(lookMat);
  camera.quaternion.slerp(tmpQuat, rotAlpha);

  // --- HUD ---
  el.rings.textContent = `${score} / ${CONFIG.ringCount}`;
  el.time.textContent = formatTime(elapsed);
  el.speed.textContent = String(Math.round(currentSpeed));
  const ai = activeRingIndex();
  el.next.textContent =
    ai >= 0
      ? `${Math.round(ship.position.distanceTo(rings[ai].pos))} u`
      : "—";
}

// ---- Render ---------------------------------------------------------------
function render() {
  scene.traverse(darkenNonBloomed);
  bloomComposer.render();
  scene.traverse(restoreMaterial);
  finalComposer.render();
}

// ---- Main loop ------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  render();
  requestAnimationFrame(animate);
}
styleRings(0);
animate();

// ---- Resize ---------------------------------------------------------------
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  bloomComposer.setSize(w, h);
  finalComposer.setSize(w, h);
});
