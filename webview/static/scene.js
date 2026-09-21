import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

// Units are mm. Panel front face is z = 0, base top is y = 0, x is centered.
const PANEL = { w: 200, h: 260, t: 5 };
const OPENING = { x0: -35, x1: 35, y0: 20, y1: 90 };
const AXIS = new THREE.Vector3(0, 200, -24);
const ARM_R = 45;
const FLAP = { w: 90, h: 85, t: 3, y0: 12, z: -11.5 };
const NUM_LEDS = 8;

const VIEWS = {
  front: { pos: [0, 200, 470], target: [0, 120, 0] },
  rear:  { pos: [0, 230, -470], target: [0, 120, -15] },
  iso:   { pos: [320, 215, 400], target: [0, 110, -20] },
};

const LED_COLORS = [0x2f7ff0, 0x2f7ff0, 0x2f7ff0, 0x2f7ff0, 0xff9f1a, 0xff9f1a, 0xff9f1a, 0x2ecc71];

// Cat coats. Textures are painted on canvases sized for a ~40 mm scale-model cat:
// image bottom edge maps to the spine, top edge to the belly.
const COATS = {
  black:    { base: "#2b2f3a", eye: 0xf2c14e },
  orange:   { base: "#e59a45", stripe: "#b25a1b", belly: "#f7dfbd", eye: 0xd9922b, stripes: 10 },
  siamese:  { base: "#efe3cf", points: "#4a3226", eye: 0x4aa3e0 },
  mackerel: { base: "#9a9584", stripe: "#3a3934", belly: "#dcd7c9", eye: 0x9ac34a, stripes: 14 },
  white:    { base: "#f4f2ec", eye: 0x5bb3e6 },
  calico:   { base: "#f4f1ea", patches: ["#e08a3c", "#2b2a2e"], eye: 0xe0b53a },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function paintBase(g, size, coat) {
  g.fillStyle = coat.base;
  g.fillRect(0, 0, size, size);
  if (coat.belly) {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, coat.belly); grad.addColorStop(0.4, coat.belly + "00");
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
  }
  if (coat.points) {
    const grad = g.createLinearGradient(0, size * 0.55, 0, size);
    grad.addColorStop(0, coat.points + "00"); grad.addColorStop(1, coat.points + "66");
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
  }
}

function paintStripes(g, size, coat, seed, count, x0 = 0, x1 = 1) {
  const r = rng(seed);
  g.strokeStyle = coat.stripe; g.lineCap = "round"; g.globalAlpha = 0.9;
  const span = (x1 - x0) * size;
  for (let i = 0; i < count; i++) {
    const x = x0 * size + (i + 0.5) / count * span + (r() - 0.5) * span / count * 0.5;
    const wob = (r() - 0.5) * size * 0.07;
    const top = size * (0.22 + r() * 0.16);
    g.lineWidth = span / count * (0.26 + r() * 0.18);
    g.beginPath();
    g.moveTo(x, size);
    g.bezierCurveTo(x + wob, size * 0.72, x - wob, size * 0.45, x + wob * 0.4, top);
    g.stroke();
  }
  const spine = g.createLinearGradient(0, size * 0.86, 0, size);
  spine.addColorStop(0, coat.stripe + "00"); spine.addColorStop(1, coat.stripe + "cc");
  g.globalAlpha = 1; g.fillStyle = spine; g.fillRect(0, size * 0.86, size, size * 0.14);
}

function paintPatches(g, size, coat, seed, count) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    g.fillStyle = coat.patches[i % 2];
    const cx = r() * size, cy = r() * size, rx = size * (0.07 + r() * 0.1), ry = size * (0.06 + r() * 0.09);
    const rot = r() * Math.PI;
    for (const dx of [-size, 0, size]) {           // wrap across the seam
      g.beginPath(); g.ellipse(cx + dx, cy, rx, ry, rot, 0, Math.PI * 2); g.fill();
    }
  }
}

function bodyTexture(coat) {
  if (!coat.stripe && !coat.patches && !coat.points) return null;
  return makeTexture(512, (g, s) => {
    paintBase(g, s, coat);
    if (coat.stripe) paintStripes(g, s, coat, 7, coat.stripes);
    if (coat.patches) paintPatches(g, s, coat, 11, 9);
  });
}

// The face looks down +z, which is u = 0.25 on a sphere; eyes sit near v = 0.45.
function headTexture(coat) {
  if (!coat.stripe && !coat.patches && !coat.points) return null;
  return makeTexture(512, (g, s) => {
    paintBase(g, s, coat);
    if (coat.stripe) paintStripes(g, s, coat, 3, Math.round(coat.stripes * 0.5), 0.5, 1.0);
    if (coat.patches) paintPatches(g, s, coat, 5, 4);
    if (coat.points) {
      const mask = g.createRadialGradient(s * 0.25, s * 0.6, s * 0.05, s * 0.25, s * 0.6, s * 0.3);
      mask.addColorStop(0, coat.points); mask.addColorStop(0.6, coat.points + "e6"); mask.addColorStop(1, coat.points + "00");
      g.fillStyle = mask; g.fillRect(0, 0, s, s);
    }
  });
}

// Tube UVs run u along the tail, v around it: rings are vertical bands.
function tailTexture(coat) {
  if (!coat.stripe && !coat.patches && !coat.points) return null;
  return makeTexture(256, (g, s) => {
    g.fillStyle = coat.points || coat.base; g.fillRect(0, 0, s, s);
    if (coat.stripe) {
      g.fillStyle = coat.stripe;
      for (let i = 0; i < 7; i++) g.fillRect(s * (0.1 + i * 0.13), 0, s * 0.06, s);
      g.fillRect(s * 0.93, 0, s * 0.07, s);
    }
    if (coat.patches) paintPatches(g, s, coat, 17, 4);
  });
}

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0, ...opts });
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function wireGrid(w, h, step, mat) {
  const pts = [];
  for (let x = -w / 2; x <= w / 2 + 0.01; x += step) pts.push(x, 0, 0, x, h, 0);
  for (let y = 0; y <= h + 0.01; y += step) pts.push(-w / 2, y, 0, w / 2, y, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, mat);
}

export class DoorScene {
  constructor(container, onScratch) {
    this.container = container;
    this.onScratch = onScratch;
    this.simOn = false;
    this.snap = null;
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 10, 3000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.minDistance = 150;
    this.controls.maxDistance = 1200;
    this.setView("iso", true);

    this.buildLights();
    this.buildBooth();
    this.buildPanel();
    this.buildFront();
    this.buildMechanism();
    this.buildCat();
    this.bindPointer();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- construction ----------------------------------------------------

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556070, 0.9);
    this.scene.add(this.hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(220, 420, 320);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -320;
    key.shadow.camera.right = key.shadow.camera.top = 320;
    key.shadow.camera.near = 50; key.shadow.camera.far = 1200;
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
    fill.position.set(-260, 260, -380);
    this.scene.add(fill);
  }

  buildBooth() {
    const wood = std(0xd3b98d, { roughness: 0.7 });
    this.scene.add(box(200, 12, 200, wood, 0, -6, -30));

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -12;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // black wire-mesh room behind the door
    const mesh = new THREE.LineBasicMaterial({ color: 0x3a3f4a, transparent: true, opacity: 0.55 });
    const back = wireGrid(200, 150, 12.5, mesh); back.position.set(0, 0, -128); this.scene.add(back);
    const left = wireGrid(120, 150, 12.5, mesh); left.rotation.y = Math.PI / 2; left.position.set(-100, 0, -68); this.scene.add(left);
    const right = left.clone(); right.position.x = 100; this.scene.add(right);
    const top = wireGrid(200, 120, 12.5, mesh); top.rotation.x = -Math.PI / 2; top.position.set(0, 150, -8); this.scene.add(top);
  }

  buildPanel() {
    const foam = std(0xe8e8e3, { roughness: 0.95 });
    const shape = new THREE.Shape();
    shape.moveTo(-PANEL.w / 2, 0); shape.lineTo(PANEL.w / 2, 0);
    shape.lineTo(PANEL.w / 2, PANEL.h); shape.lineTo(-PANEL.w / 2, PANEL.h); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(OPENING.x0, OPENING.y0); hole.lineTo(OPENING.x1, OPENING.y0);
    hole.lineTo(OPENING.x1, OPENING.y1); hole.lineTo(OPENING.x0, OPENING.y1); hole.closePath();
    shape.holes.push(hole);
    const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: PANEL.t, bevelEnabled: false }), foam);
    panel.position.z = -PANEL.t;
    panel.castShadow = panel.receiveShadow = true;
    this.scene.add(panel);

    // wooden frame strips on the rear perimeter
    const strip = std(0xcdbf9f);
    const z = -PANEL.t - 5;
    this.scene.add(box(200, 10, 10, strip, 0, 5, z));
    this.scene.add(box(200, 10, 10, strip, 0, 255, z));
    this.scene.add(box(10, 240, 10, strip, -95, 130, z));
    this.scene.add(box(10, 240, 10, strip, 95, 130, z));

    // triangular braces to the base
    const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(-60, 0); tri.lineTo(0, 90); tri.closePath();
    const braceGeo = new THREE.ExtrudeGeometry(tri, { depth: 5, bevelEnabled: false });
    for (const x of [-97.5, 92.5]) {
      const b = new THREE.Mesh(braceGeo, foam);
      b.rotation.y = -Math.PI / 2;
      b.position.set(x, 0, -PANEL.t - 10);
      b.castShadow = b.receiveShadow = true;
      this.scene.add(b);
    }
  }

  buildFront() {
    // acrylic scratch pad floated on foam tape
    const acrylic = new THREE.MeshStandardMaterial({
      color: 0x4fb79b, transparent: true, opacity: 0.62, roughness: 0.15, metalness: 0.05, side: THREE.DoubleSide,
    });
    this.pad = box(90, 75, 3, acrylic, 0, 152.5, 3.5);
    this.pad.castShadow = false;
    this.scene.add(this.pad);
    for (const [x, y] of [[-40, 120], [40, 120], [-40, 185], [40, 185]]) {
      this.scene.add(box(8, 8, 2, std(0xbfc3c8), x, y, 1));
    }
    const piezo = new THREE.Mesh(new THREE.CylinderGeometry(13.5, 13.5, 0.6, 40), std(0xc9a44a, { metalness: 0.7, roughness: 0.35 }));
    piezo.rotation.x = Math.PI / 2;
    piezo.position.set(0, 152.5, 1.7);
    this.scene.add(piezo);

    // LED strip, hood, pixels
    this.scene.add(box(116, 12, 2, std(0x23262d, { roughness: 0.6 }), 0, 101, 1));
    const hood = box(120, 1.5, 14, std(0xf2f2ee), 0, 108.75, 7);
    this.scene.add(hood);
    this.leds = [];
    for (let i = 0; i < NUM_LEDS; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, emissive: 0x000000, emissiveIntensity: 1.8, roughness: 0.4 });
      const px = box(8, 8, 2, mat, -50.75 + i * 14.5, 101, 3);
      px.castShadow = false;
      this.leds.push(px);
      this.scene.add(px);
    }

    // ultrasonic module and difficulty button
    const sonar = new THREE.Group();
    sonar.add(box(45, 20, 2, std(0x3f9f86), 0, 0, 1));
    for (const dx of [-11, 11]) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 10, 32), std(0xc9d3d0, { metalness: 0.5, roughness: 0.4 }));
      can.rotation.x = Math.PI / 2; can.position.set(dx, 0, 6); can.castShadow = true;
      sonar.add(can);
    }
    sonar.position.set(70, 35, 0);
    this.scene.add(sonar);

    const btn = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 4, 32), std(0x3aa88a));
    btn.rotation.x = Math.PI / 2; btn.position.set(-80, 8, 2); btn.castShadow = true;
    this.scene.add(btn);

    // IR beam across the opening
    const dark = std(0x4a4f5a);
    this.scene.add(box(3, 4, 4, dark, OPENING.x0 + 1.5, 35, -2.5));
    this.scene.add(box(3, 4, 4, dark, OPENING.x1 - 1.5, 35, -2.5));
    this.beamMat = new THREE.LineBasicMaterial({ color: 0xd9463f, transparent: true, opacity: 0.25 });
    const bg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(OPENING.x0 + 3, 35, -2.5), new THREE.Vector3(OPENING.x1 - 3, 35, -2.5)]);
    this.scene.add(new THREE.Line(bg, this.beamMat));
  }

  buildMechanism() {
    const foam = std(0xdedfda, { roughness: 0.95 });
    const zSpacer = -PANEL.t - 2.5, zCover = -PANEL.t - 5 - FLAP.t - 2.5 - 1;
    for (const x of [-50, 50]) this.scene.add(box(10, 180, 5, foam, x, 100, zSpacer));
    for (const x of [-44, 44]) {
      const c = box(22, 180, 5, std(0xe3e3de, { roughness: 0.95, transparent: true, opacity: 0.85 }), x, 100, zCover);
      this.scene.add(c);
    }
    this.scene.add(box(90, 5, 5, foam, 0, 12.5, zSpacer));

    // flap with M8 nut weights
    this.flap = new THREE.Group();
    const plate = box(FLAP.w, FLAP.h, FLAP.t, std(0xe0703a, { roughness: 0.8 }), 0, FLAP.h / 2, 0);
    this.flap.add(plate);
    const nutMat = std(0x8d9099, { metalness: 0.8, roughness: 0.35 });
    for (let i = 0; i < 5; i++) {
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 6.5, 6), nutMat);
      nut.rotation.x = Math.PI / 2;
      nut.position.set(-32 + i * 16, 9, -FLAP.t / 2 - 3.3);
      nut.castShadow = true;
      this.flap.add(nut);
    }
    this.flap.position.set(0, FLAP.y0, FLAP.z);
    this.scene.add(this.flap);

    // servo on a foam mount, arm rotating in the panel plane
    const mount = box(30, 26, 12, foam, 0, 200, -PANEL.t - 5 - 6);
    this.scene.add(mount);
    const servo = box(23, 22.5, 12.2, std(0x3f74e0, { roughness: 0.5 }), AXIS.x, AXIS.y - 4, AXIS.z - 6.1);
    this.scene.add(servo);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 20), std(0xf0f0f0));
    shaft.rotation.x = Math.PI / 2; shaft.position.set(AXIS.x, AXIS.y, AXIS.z + 1.5);
    this.scene.add(shaft);

    this.arm = new THREE.Group();
    const armMat = std(0x5a3ee6, { transparent: true, opacity: 0.88, roughness: 0.25 });
    const bar = box(6, ARM_R + 4, 2, armMat, 0, -ARM_R / 2 + 2, 0);
    this.arm.add(bar);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 4, 12), std(0x222222));
    pin.rotation.x = Math.PI / 2; pin.position.set(0, -ARM_R, 0);
    this.arm.add(pin);
    this.arm.position.set(AXIS.x, AXIS.y, AXIS.z + 4);
    this.scene.add(this.arm);

    // arm trajectory guide
    const arc = new THREE.EllipseCurve(0, 0, ARM_R, ARM_R, -Math.PI / 2, Math.PI / 2, false).getPoints(48);
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arc.map(p => new THREE.Vector3(p.x, p.y, 0)));
    const guide = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: 0x3f74e0, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.6 }));
    guide.computeLineDistances();
    guide.position.set(AXIS.x, AXIS.y, AXIS.z + 6);
    this.scene.add(guide);

    this.stringGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.scene.add(new THREE.Line(this.stringGeo, new THREE.LineBasicMaterial({ color: 0x1a1d24 })));
  }

  buildCat() {
    const mats = this.catMats = {
      body: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      head: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      tail: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      ear:  new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      eye:  new THREE.MeshStandardMaterial({ emissiveIntensity: 0.9 }),
    };
    const cat = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(17, 40, 28), mats.body);
    body.scale.set(1.25, 0.95, 1.05); body.position.y = 16; body.castShadow = true;
    cat.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(10.5, 40, 28), mats.head);
    head.position.set(0, 38, 8); head.castShadow = true;
    cat.add(head);
    const pupilMat = std(0x111111, { roughness: 0.3 });
    for (const dx of [-6.5, 6.5]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(3.6, 7, 12), mats.ear);
      ear.position.set(dx, 47.5, 7); ear.rotation.z = dx < 0 ? 0.3 : -0.3;
      cat.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 14), mats.eye);
      eye.position.set(dx * 0.6, 39, 17.5);
      cat.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), pupilMat);
      pupil.scale.set(0.6, 1.4, 0.6); pupil.position.set(dx * 0.6, 39, 19);
      cat.add(pupil);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 10), std(0xe39a9a, { roughness: 0.6 }));
    nose.position.set(0, 36.3, 18.6);
    cat.add(nose);
    const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(14, 12, -12), new THREE.Vector3(26, 10, -16), new THREE.Vector3(32, 22, -10), new THREE.Vector3(28, 34, -4)]);
    this.tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 24, 2.6, 10, false), mats.tail);
    cat.add(this.tail);
    cat.position.set(0, 0, -78);
    this.cat = cat;
    this.scene.add(cat);
    this.setCoat("black");
  }

  setCoat(name) {
    const coat = COATS[name] || COATS.black;
    this.coat = COATS[name] ? name : "black";
    const m = this.catMats;
    const apply = (mat, tex) => {
      if (mat.map) mat.map.dispose();
      mat.map = tex;
      mat.color.set(tex ? 0xffffff : coat.base);
      mat.needsUpdate = true;
    };
    apply(m.body, bodyTexture(coat));
    apply(m.head, headTexture(coat));
    apply(m.tail, tailTexture(coat));
    m.ear.color.set(coat.points || coat.stripe || (coat.patches ? coat.patches[1] : coat.base));
    m.eye.color.set(coat.eye); m.eye.emissive.set(coat.eye);
  }

  // ---- interaction -----------------------------------------------------

  bindPointer() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let scratching = false, last = null, lastSend = 0;

    const hitPad = e => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      return ray.intersectObject(this.pad).length > 0;
    };

    el.addEventListener("pointerdown", e => {
      if (!this.simOn || !hitPad(e)) return;
      scratching = true;
      this.controls.enabled = false;
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.onScratch(200);
    });
    el.addEventListener("pointermove", e => {
      if (this.simOn && !scratching) el.style.cursor = hitPad(e) ? "crosshair" : "";
      if (!scratching) return;
      const now = performance.now();
      const d = Math.hypot(e.clientX - last.x, e.clientY - last.y);
      const dt = Math.max(1, now - last.t);
      last = { x: e.clientX, y: e.clientY, t: now };
      if (now - lastSend < 30) return;
      lastSend = now;
      this.onScratch(hitPad(e) ? Math.min(1000, 120 + (d / dt) * 550) : 0);
    });
    const stop = () => { scratching = false; this.controls.enabled = true; };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener("pointerleave", stop);
  }

  setView(name, immediate = false) {
    const v = VIEWS[name]; if (!v) return;
    this.viewTarget = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target), immediate };
  }

  setAutoRotate(on) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 0.9; }

  setTheme(dark) {
    this.hemi.intensity = dark ? 0.75 : 0.95;
    this.hemi.groundColor.set(dark ? 0x2a303a : 0x707a88);
  }

  update(snap) { this.snap = snap; }

  // ---- per frame -------------------------------------------------------

  frame() {
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;

    if (this.viewTarget) {
      const { pos, target, immediate } = this.viewTarget;
      if (immediate) { this.camera.position.copy(pos); this.controls.target.copy(target); this.viewTarget = null; }
      else {
        this.camera.position.lerp(pos, 1 - Math.pow(0.001, dt));
        this.controls.target.lerp(target, 1 - Math.pow(0.001, dt));
        if (this.camera.position.distanceTo(pos) < 0.5) this.viewTarget = null;
      }
    }
    this.controls.update();

    const s = this.snap;
    if (s) {
      this.flap.position.y = FLAP.y0 + s.rise;
      this.arm.rotation.z = THREE.MathUtils.degToRad(s.angle);

      const tip = new THREE.Vector3(0, -ARM_R, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), this.arm.rotation.z).add(this.arm.position);
      const top = new THREE.Vector3(0, FLAP.y0 + s.rise + FLAP.h, FLAP.z);
      const pos = this.stringGeo.attributes.position;
      pos.setXYZ(0, tip.x, tip.y, tip.z); pos.setXYZ(1, top.x, top.y, top.z);
      pos.needsUpdate = true;

      for (let i = 0; i < NUM_LEDS; i++) {
        const on = i < s.lit;
        const m = this.leds[i].material;
        m.emissive.setHex(on ? LED_COLORS[i] : 0x000000);
        m.color.setHex(on ? LED_COLORS[i] : 0x3a3d44);
      }

      const hot = s.peak > s.scratch_amp;
      this.pad.material.emissive.setHex(0x4fb79b);
      this.pad.material.emissiveIntensity = hot ? 0.35 + Math.min(0.5, s.peak / 1500) : 0;

      this.beamMat.opacity = s.beam_blocked ? 1 : 0.25;

      const open = s.state === "open" || s.state === "opening";
      const wantZ = open ? -52 : -78;
      this.cat.position.z += (wantZ - this.cat.position.z) * Math.min(1, dt * 2.5);
      this.cat.position.y = open ? Math.sin(t * 6) * 1.2 : 0;
    }
    this.tail.rotation.y = Math.sin(t * 1.7) * 0.25;

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
