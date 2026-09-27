import * as THREE from './vendor/three.module.js';

const canvas = document.querySelector('#track');
const $ = (selector) => document.querySelector(selector);
const ui = {
  menu: $('#menu'), pauseMenu: $('#pauseMenu'), results: $('#results'),
  hud: $('#hud'), touch: $('#touchControls'), pause: $('#pauseButton'),
  countdown: $('#countdown'), toast: $('#toast'), position: $('#position'),
  lap: $('#lap'), time: $('#time'), speed: $('#speed'),
  charge: $('#chargeValue'), chargeFill: $('#chargeFill'),
  boostHint: $('#boostHint'), resultPlace: $('#resultPlace'),
  resultSummary: $('#resultSummary'),
};
const mapCanvas = $('#minimap');
const mapCtx = mapCanvas.getContext('2d');
const keys = { left: false, right: false, gas: false, drift: false, boost: false };
const pointerControls = new Map();
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ROAD_HALF = 9;
const MAX_SPEED = 65;
const RACE_LAPS = 3;
const AI_COLORS = [0xfa5b73, 0xffe25c, 0x48dec9, 0xa486f4, 0xff9a4d];
const clock = new THREE.Clock();
const up = new THREE.Vector3(0, 1, 0);
let renderer;
let scene;
let camera;
let curve;
let trackLength;
let playerKart;
let opponents = [];
let smoke = [];
let lastSmoke = 0;
let toastUntil = 0;
let previousCountdown = '';
let game = freshGame();

function freshGame() {
  return {
    mode: 'menu', countdown: 3, distance: 0, speed: 0, lateral: 0,
    steerMomentum: 0, driftCharge: 0, boostTime: 0, raceTime: 0,
    offRoadNotified: false, cameraReady: false,
    ai: AI_COLORS.map((color, i) => ({
      color, distance: 9 + i * 6, lateral: [-3, 2, .1, -2, 3][i],
      speed: 45 + i * 2.5, phase: i * 1.7,
    })),
  };
}

function makeMaterial(color, roughness = .75, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function box(parent, width, height, depth, material, x, y, z) {
  return mesh(new THREE.BoxGeometry(width, height, depth), material, parent, x, y, z);
}

function createCurve() {
  const points = [
    [0, 0, 0], [58, 2, 45], [155, 4, 78], [246, 1, 48],
    [276, 0, -30], [238, 3, -108], [160, 6, -141], [75, 2, -119],
    [7, 1, -149], [-87, 4, -122], [-153, 2, -58], [-153, 0, 25],
    [-95, 3, 78], [-32, 1, 70],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', .5);
  curve.arcLengthDivisions = 1600;
  trackLength = curve.getLength();
}

function pose(distance) {
  const t = ((distance % trackLength) + trackLength) % trackLength / trackLength;
  const point = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  return { point, tangent, right, t };
}

function createRoad() {
  const count = 700;
  const samples = [];
  for (let i = 0; i <= count; i++) samples.push(pose(trackLength * i / count));

  function ribbon(left, right, material, yOffset = 0, step = 1) {
    const positions = [];
    const uvs = [];
    for (let i = 0; i < count; i += step) {
      const a = samples[i], b = samples[Math.min(i + step, count)];
      const vertex = (sample, offset) => {
        const point = sample.point.clone().addScaledVector(sample.right, offset);
        point.y += yOffset;
        positions.push(point.x, point.y, point.z);
      };
      vertex(a, left); vertex(a, right); vertex(b, right);
      vertex(a, left); vertex(b, right); vertex(b, left);
      const v0 = i / count * trackLength / 18;
      const v1 = (i + step) / count * trackLength / 18;
      uvs.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    const road = new THREE.Mesh(geometry, material);
    road.frustumCulled = false;
    scene.add(road);
    return road;
  }

  const terrain = makeMaterial(0x61b772, 1);
  terrain.side = THREE.DoubleSide;
  ribbon(-120, 120, terrain, -.42);
  const verge = makeMaterial(0x439e60, 1);
  verge.side = THREE.DoubleSide;
  ribbon(-14, 14, verge, -.25);

  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = asphaltCanvas.height = 128;
  const asphalt = asphaltCanvas.getContext('2d');
  asphalt.fillStyle = '#59646f';
  asphalt.fillRect(0, 0, 128, 128);
  let seed = 89;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 3300; i++) {
    const light = 75 + Math.floor(random() * 65);
    asphalt.fillStyle = 'rgba(' + light + ',' + light + ',' + light + ',.16)';
    asphalt.fillRect(random() * 128, random() * 128, 1 + random() * 2, 1 + random() * 2);
  }
  const asphaltTexture = new THREE.CanvasTexture(asphaltCanvas);
  asphaltTexture.wrapS = asphaltTexture.wrapT = THREE.RepeatWrapping;
  asphaltTexture.colorSpace = THREE.SRGBColorSpace;
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: asphaltTexture, roughness: .96, side: THREE.DoubleSide,
  });
  ribbon(-ROAD_HALF, ROAD_HALF, roadMaterial, .02);

  const white = new THREE.MeshBasicMaterial({ color: 0xfff8e5, side: THREE.DoubleSide });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xf8dc6c, side: THREE.DoubleSide });
  ribbon(-ROAD_HALF + .48, -ROAD_HALF + .58, white, .047);
  ribbon(ROAD_HALF - .58, ROAD_HALF - .48, white, .047);
  ribbon(-.08, .08, yellow, .048);
  function quad(out, a, b, left, right, height) {
    for (const [p, offset] of [[a, left], [a, right], [b, right],
                              [a, left], [b, right], [b, left]]) {
      const v = p.point.clone().addScaledVector(p.right, offset);
      out.push(v.x, v.y + height, v.z);
    }
  }
  function addQuads(positions, material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    mesh(geometry, material, scene);
  }
  const laneMarks = [];
  for (const lane of [-ROAD_HALF / 2, ROAD_HALF / 2]) {
    for (let i = 0; i < count; i += 13) {
      const a = samples[i], b = samples[Math.min(i + 6, count)];
      quad(laneMarks, a, b, lane - .08, lane + .08, .052);
    }
  }
  addQuads(laneMarks, white);

  const curbWhite = new THREE.MeshBasicMaterial({ color: 0xf7f8ed, side: THREE.DoubleSide });
  const curbRed = new THREE.MeshBasicMaterial({ color: 0xed5a5b, side: THREE.DoubleSide });
  const redSegments = [], whiteSegments = [];
  for (let i = 0; i < count; i += 5) {
    const a = samples[i], b = samples[Math.min(i + 5, count)];
    for (const side of [-1, 1]) {
      const inner = side * ROAD_HALF;
      const outer = side * (ROAD_HALF + 1.05);
      quad((i / 5) % 2 ? redSegments : whiteSegments,
        a, b, inner, outer, .06);
    }
  }
  addQuads(redSegments, curbRed);
  addQuads(whiteSegments, curbWhite);

  const railMaterial = makeMaterial(0x3876ad, .45, .2);
  const railTop = makeMaterial(0xe6f3f7, .5);
  const postMatrices = [];
  for (const side of [-1, 1]) {
    const positions = [];
    for (let i = 0; i < count; i++) {
      const a = samples[i], b = samples[i + 1];
      for (const [p, y] of [[a, .35], [a, 1.05], [b, 1.05],
                            [a, .35], [b, 1.05], [b, .35]]) {
        const v = p.point.clone().addScaledVector(p.right, side * 12);
        positions.push(v.x, v.y + y, v.z);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    const rail = mesh(geom, railMaterial, scene);
    rail.material.side = THREE.DoubleSide;
    for (let i = 0; i < count; i += 17) {
      const p = samples[i];
      const point = p.point.clone().addScaledVector(p.right, side * 12);
      const dummy = new THREE.Object3D();
      dummy.position.set(point.x, point.y + .65, point.z);
      dummy.rotation.y = Math.atan2(p.tangent.x, p.tangent.z);
      dummy.updateMatrix();
      postMatrices.push(dummy.matrix.clone());
    }
  }
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(.3, 1.3, .3),
    railTop, postMatrices.length);
  postMatrices.forEach((matrix, index) => posts.setMatrixAt(index, matrix));
  posts.instanceMatrix.needsUpdate = true;
  scene.add(posts);

  const start = samples[0];
  const marker = makeMaterial(0xffffff, 1);
  for (let column = 0; column < 12; column++) {
    for (let row = 0; row < 2; row++) {
      const tile = box(scene, 1.5, .025, .9,
        (column + row) % 2 ? marker : makeMaterial(0x253444, 1),
        start.point.x, start.point.y + .09, start.point.z);
      const local = start.right.clone().multiplyScalar(-ROAD_HALF + .75 + column * 1.5)
        .addScaledVector(start.tangent, row * .9);
      tile.position.add(local);
      tile.rotation.y = Math.atan2(start.tangent.x, start.tangent.z);
    }
  }
  createArch(pose(28));
}

function textTexture(text, foreground, background) {
  const el = document.createElement('canvas');
  el.width = 512; el.height = 128;
  const c = el.getContext('2d');
  c.fillStyle = background; c.fillRect(0, 0, 512, 128);
  c.fillStyle = foreground;
  c.font = '900 72px Kanit, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createArch(at) {
  const cobalt = makeMaterial(0x244d9d, .4, .15);
  const signMat = new THREE.MeshBasicMaterial({
    map: textTexture('TURBO TRAIL', '#ffe044', '#203e85'),
    side: THREE.DoubleSide,
  });
  const gantry = new THREE.Group();
  gantry.position.copy(at.point);
  gantry.rotation.y = Math.atan2(at.tangent.x, at.tangent.z);
  box(gantry, .9, 8.3, .9, cobalt, -11, 4.1, 0);
  box(gantry, .9, 8.3, .9, cobalt, 11, 4.1, 0);
  box(gantry, 23, 1.6, 1.2, cobalt, 0, 8.2, 0);
  const sign = mesh(new THREE.PlaneGeometry(16, 3.4), signMat, gantry, 0, 8.2, .66);
  sign.material.transparent = false;
  scene.add(gantry);
}

function createScenery() {
  const trunkGeo = new THREE.CylinderGeometry(.26, .38, 2.5, 6);
  const leafGeo = new THREE.ConeGeometry(2.3, 5, 7);
  const foliage = new THREE.MeshLambertMaterial({ color: 0x2e966c });
  const trunks = new THREE.InstancedMesh(trunkGeo, makeMaterial(0x7e624a, 1), 175);
  const crowns = new THREE.InstancedMesh(leafGeo, foliage, 175);
  const dummy = new THREE.Object3D();
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 175; i++) {
    const sample = pose(trackLength * ((i * .61803398875) % 1));
    const side = i % 2 ? -1 : 1;
    const offset = side * (22 + random() * 52);
    const position = sample.point.clone().addScaledVector(sample.right, offset);
    const scale = .75 + random() * .8;
    dummy.position.set(position.x, position.y + scale * 1.15, position.z);
    dummy.rotation.y = random() * Math.PI;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = position.y + scale * 5.3;
    dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
  scene.add(trunks, crowns);

  const houseColors = [0xffcb73, 0xf7e5c0, 0x9ed9dd, 0xe89fa9];
  for (let i = 0; i < 25; i++) {
    const at = pose(trackLength * ((i * .193 + .07) % 1));
    const side = i % 2 ? -1 : 1;
    const position = at.point.clone().addScaledVector(at.right, side * (42 + random() * 35));
    const home = new THREE.Group();
    home.position.copy(position);
    home.rotation.y = random() * Math.PI * 2;
    const wall = makeMaterial(houseColors[i % houseColors.length], .95);
    box(home, 6, 5, 6, wall, 0, 2.5, 0);
    const roof = mesh(new THREE.ConeGeometry(5.2, 3, 4), makeMaterial(0x9d6074), home, 0, 6.3, 0);
    roof.rotation.y = Math.PI / 4;
    box(home, 1.7, 1.7, .08, makeMaterial(0x79cfe7), -1.3, 3.1, 3.05);
    box(home, 1.7, 1.7, .08, makeMaterial(0x79cfe7), 1.3, 3.1, 3.05);
    scene.add(home);
  }

  const mountainMaterials = [0x8ab2b7, 0x73a8b4, 0x9ac4ba].map((color) => makeMaterial(color, 1));
  for (let i = 0; i < 22; i++) {
    const angle = i * Math.PI * 2 / 22;
    const radius = 350 + random() * 90;
    const size = 55 + random() * 55;
    const mountain = mesh(new THREE.ConeGeometry(size, size * 1.2, 5),
      mountainMaterials[i % mountainMaterials.length], scene,
      65 + Math.cos(angle) * radius, size * .42 - 9, -30 + Math.sin(angle) * radius);
    mountain.rotation.y = random() * Math.PI;
  }

  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .82 });
  for (let i = 0; i < 25; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 100 + random() * 270;
    const cloud = new THREE.Group();
    cloud.position.set(65 + Math.cos(angle) * radius, 65 + random() * 28, -30 + Math.sin(angle) * radius);
    for (let j = 0; j < 3; j++) {
      const puff = mesh(new THREE.SphereGeometry(7 + random() * 6, 8, 6), cloudMat,
        cloud, (j - 1) * 9, random() * 3, 0);
      puff.scale.y = .45;
    }
    scene.add(cloud);
  }
}

function createKart(color) {
  const group = new THREE.Group();
  const chassis = new THREE.Group();
  group.add(chassis);
  const body = makeMaterial(color, .28, .12);
  const bodyLight = makeMaterial(new THREE.Color(color).lerp(new THREE.Color(0xffffff), .22), .3, .1);
  const dark = makeMaterial(0x1d2940, .7);
  const rubber = makeMaterial(0x151c2a, 1);
  const rim = makeMaterial(0xf5f6fa, .25, .48);
  const glass = makeMaterial(0x88eaf4, .15, .28);
  const red = new THREE.MeshBasicMaterial({ color: 0xff494c });
  const skin = makeMaterial(0xffd6a6, .7);
  const helmet = makeMaterial(0x2752bd, .27, .1);

  box(chassis, 3.15, .62, 4.45, body, 0, .73, 0);
  box(chassis, 2.65, .40, 1.5, bodyLight, 0, 1.05, 1.2);
  box(chassis, 3.55, .32, .55, body, 0, .63, 2.15);
  box(chassis, 3.55, .30, .58, dark, 0, .63, -2.1);
  box(chassis, 3.25, .18, .55, bodyLight, 0, 1.45, -2.0);
  box(chassis, 1.6, .74, 1.1, dark, 0, 1.13, -.52);
  box(chassis, 2.2, .4, .16, glass, 0, 1.45, .78);
  box(chassis, .6, .22, .10, red, -1.05, .83, -2.4);
  box(chassis, .6, .22, .10, red, 1.05, .83, -2.4);
  box(chassis, .68, .23, .1, makeMaterial(0xfff1b0), -1, .82, 2.46);
  box(chassis, .68, .23, .1, makeMaterial(0xfff1b0), 1, .82, 2.46);
  for (const x of [-1.76, 1.76]) {
    for (const z of [-1.4, 1.45]) {
      const tire = mesh(new THREE.CylinderGeometry(.60, .60, .47, 12), rubber, chassis, x, .62, z);
      tire.rotation.z = Math.PI / 2;
      const hub = mesh(new THREE.CylinderGeometry(.30, .30, .49, 12), rim, chassis,
        x + Math.sign(x) * .02, .62, z);
      hub.rotation.z = Math.PI / 2;
    }
  }
  mesh(new THREE.SphereGeometry(.62, 16, 12), skin, chassis, 0, 2.1, -.67);
  const helm = mesh(new THREE.SphereGeometry(.76, 16, 12), helmet, chassis, 0, 2.42, -.67);
  helm.scale.y = .8;
  box(chassis, 1.15, .29, .15, glass, 0, 2.24, -.03);
  box(chassis, 1.1, .12, .33, helmet, 0, 2.48, -.05);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x60eaff, transparent: true, opacity: .9, depthWrite: false,
  });
  const flames = [];
  for (const x of [-.9, .9]) {
    const flame = mesh(new THREE.ConeGeometry(.25, 1.4, 7), flameMat, chassis, x, .62, -2.7);
    flame.rotation.x = -Math.PI / 2;
    flame.visible = false;
    flames.push(flame);
  }
  group.userData = { chassis, flames };
  scene.add(group);
  return group;
}

function setup3D() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8cd9f8);
  scene.fog = new THREE.FogExp2(0xa9dcdf, .0024);
  camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, .15, 640);
  scene.add(new THREE.HemisphereLight(0xe5faff, 0x6c9b61, 2.2));
  const sunlight = new THREE.DirectionalLight(0xffefc8, 2.3);
  sunlight.position.set(-90, 150, -40);
  scene.add(sunlight);
  createCurve();
  createRoad();
  createScenery();
  playerKart = createKart(0xffd72e);
  opponents = AI_COLORS.map((color) => createKart(color));
}

function syncKart(kart, distance, lateral, lean = 0, boost = false) {
  const at = pose(distance);
  kart.position.copy(at.point).addScaledVector(at.right, lateral);
  kart.position.y += .16;
  kart.rotation.y = Math.atan2(at.tangent.x, at.tangent.z);
  kart.userData.chassis.rotation.z = -lean * .10;
  kart.userData.chassis.rotation.y = lean * .075;
  for (const flame of kart.userData.flames) {
    flame.visible = boost;
    if (boost) flame.scale.y = .7 + Math.random() * .7;
  }
  return at;
}

function updateCamera(at, dt) {
  const behind = at.tangent.clone().multiplyScalar(-12.8);
  const desired = at.point.clone().add(behind)
    .addScaledVector(at.right, game.lateral * .45)
    .add(new THREE.Vector3(0, 6.2, 0));
  const target = at.point.clone().addScaledVector(at.tangent, 19)
    .add(new THREE.Vector3(0, 1.8, 0));
  if (!game.cameraReady) {
    camera.position.copy(desired);
    game.cameraReady = true;
  } else camera.position.lerp(desired, Math.min(1, dt * 5));
  camera.lookAt(target);
}

function spawnSmoke(at) {
  const material = new THREE.MeshBasicMaterial({
    color: 0xeef8ff, transparent: true, opacity: .55, depthWrite: false,
  });
  for (const side of [-1, 1]) {
    const puff = mesh(new THREE.SphereGeometry(.48, 7, 6), material.clone(), scene);
    puff.position.copy(at.point).addScaledVector(at.right, game.lateral + side * 1.5)
      .addScaledVector(at.tangent, -1.4);
    puff.position.y += .45;
    smoke.push({ puff, life: .8 });
  }
}

function updateSmoke(dt) {
  for (let i = smoke.length - 1; i >= 0; i--) {
    const particle = smoke[i];
    particle.life -= dt;
    if (particle.life <= 0) {
      scene.remove(particle.puff);
      particle.puff.material.dispose();
      smoke.splice(i, 1);
      continue;
    }
    particle.puff.position.y += dt * 1.1;
    particle.puff.scale.setScalar(1 + (1 - particle.life / .8) * 2.2);
    particle.puff.material.opacity = particle.life / .8 * .4;
  }
}

function resetRace() {
  game = freshGame();
  game.mode = 'countdown';
  ui.menu.hidden = true;
  ui.pauseMenu.hidden = true;
  ui.results.hidden = true;
  ui.hud.hidden = false;
  ui.touch.hidden = !matchMedia('(any-pointer: coarse)').matches;
  ui.pause.hidden = false;
  ui.countdown.hidden = false;
  ui.toast.hidden = true;
  previousCountdown = '';
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  pointerControls.clear();
  while (smoke.length) {
    const particle = smoke.pop();
    scene.remove(particle.puff);
    particle.puff.material.dispose();
  }
  updateHud();
}

function pauseRace() {
  if (game.mode === 'racing' || game.mode === 'countdown') {
    game.wasCounting = game.mode === 'countdown';
    game.mode = 'paused';
    ui.pauseMenu.hidden = false;
    ui.countdown.hidden = true;
    Object.keys(keys).forEach((key) => { keys[key] = false; });
  } else if (game.mode === 'paused') {
    game.mode = game.wasCounting ? 'countdown' : 'racing';
    ui.pauseMenu.hidden = true;
    ui.countdown.hidden = game.mode !== 'countdown';
  }
}

function finishRace() {
  game.mode = 'finished';
  const place = rank();
  const suffix = place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
  ui.resultPlace.textContent = String(place) + suffix;
  ui.resultSummary.textContent = 'เวลา ' + formatTime(game.raceTime) + ' · ' +
    (place === 1 ? 'สุดยอด! คุณเป็นแชมป์สนามนี้' : 'ลองใหม่แล้วแซงให้ได้!');
  ui.results.hidden = false;
  ui.touch.hidden = true;
  ui.pause.hidden = true;
}

function toast(message, duration = 1.4) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastUntil = performance.now() + duration * 1000;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return m + ':' + s + '.' + Math.floor((seconds * 10) % 10);
}

function rank() {
  return 1 + game.ai.filter((opponent) => opponent.distance > game.distance).length;
}

function updateHud() {
  ui.position.innerHTML = String(rank()) + '<span>/ 6</span>';
  ui.lap.innerHTML = String(Math.min(RACE_LAPS, Math.floor(game.distance / trackLength) + 1)) +
    '<span>/ 3</span>';
  ui.time.textContent = formatTime(game.raceTime);
  ui.speed.textContent = String(Math.round(game.speed * 3.6));
  ui.charge.textContent = String(Math.floor(game.driftCharge)) + '%';
  ui.chargeFill.style.width = String(game.driftCharge) + '%';
  const ready = game.driftCharge >= 55;
  ui.boostHint.textContent = game.boostTime > 0 ? 'TURBO ACTIVE!' :
    ready ? 'บูสต์พร้อมแล้ว!' : 'ดริฟต์เพื่อชาร์จบูสต์';
  $('.boost-button').classList.toggle('ready', ready);
}

function useBoost() {
  if (game.mode !== 'racing' || game.boostTime > 0 || game.driftCharge < 55) return;
  game.driftCharge -= 55;
  game.boostTime = 2.4;
  toast('TURBO BOOST! ⚡', 1.1);
}

function update(dt) {
  if (performance.now() > toastUntil) ui.toast.hidden = true;
  if (game.mode === 'countdown') {
    game.countdown -= dt;
    const count = Math.ceil(game.countdown);
    const label = count > 0 ? String(count) : 'GO!';
    if (label !== previousCountdown) {
      ui.countdown.textContent = label;
      previousCountdown = label;
    }
    if (game.countdown <= -.55) {
      game.mode = 'racing';
      ui.countdown.hidden = true;
    }
  } else if (game.mode === 'racing') {
    game.raceTime += dt;
    const accelerating = keys.gas || matchMedia('(any-pointer: coarse)').matches;
    const steer = Number(keys.right) - Number(keys.left);
    const drifting = keys.drift && Math.abs(steer) > 0 && game.speed > 13;
    const cap = game.boostTime > 0 ? MAX_SPEED * 1.3 : MAX_SPEED;
    game.speed += ((accelerating ? keys.gas ? 27 : 23 : -24) -
      game.speed * (game.boostTime > 0 ? .03 : .08)) * dt;
    if (game.boostTime > 0) {
      game.boostTime = Math.max(0, game.boostTime - dt);
      game.speed += 27 * dt;
    }
    if (Math.abs(game.lateral) > 7.4) {
      game.speed -= 33 * dt;
      if (!game.offRoadNotified) {
        toast('ออกนอกสนาม!');
        game.offRoadNotified = true;
      }
    } else game.offRoadNotified = false;
    game.speed = clamp(game.speed, 0, cap);
    const oldDistance = game.distance;
    game.distance += game.speed * dt;
    game.steerMomentum = lerp(game.steerMomentum, steer, Math.min(1, dt * (drifting ? 5.5 : 8)));
    game.lateral += game.steerMomentum * (drifting ? 7.5 : 5.8) *
      dt * (.35 + .65 * game.speed / MAX_SPEED);
    const before = pose(oldDistance).tangent;
    const after = pose(game.distance).tangent;
    const curvature = before.x * after.z - before.z * after.x;
    game.lateral += curvature * game.speed * .18;
    game.lateral = clamp(game.lateral, -10.7, 10.7);
    if (drifting) game.driftCharge = clamp(game.driftCharge +
      dt * 38 * (.6 + game.speed / MAX_SPEED), 0, 100);
    if (keys.boost) useBoost();
    for (const opponent of game.ai) {
      opponent.distance += opponent.speed * dt *
        (1 + Math.sin(game.raceTime * .32 + opponent.phase) * .045);
      opponent.lateral += (Math.sin(game.raceTime * .5 + opponent.phase) * 3.2 -
        opponent.lateral) * dt * .26;
      const gap = opponent.distance - game.distance;
      if (Math.abs(gap) < 3.3 && Math.abs(opponent.lateral - game.lateral) < 2.7 &&
          game.speed > 24) game.speed *= Math.max(.65, 1 - dt * 2);
    }
    if (game.distance >= trackLength * RACE_LAPS) {
      game.distance = trackLength * RACE_LAPS;
      finishRace();
    }
    updateHud();
  }

  const at = syncKart(playerKart, game.distance, game.lateral,
    game.steerMomentum * (keys.drift ? 1.5 : 1), game.boostTime > 0);
  for (let i = 0; i < game.ai.length; i++) {
    const ai = game.ai[i];
    syncKart(opponents[i], ai.distance, ai.lateral,
      Math.sin(game.raceTime * .7 + ai.phase) * .15);
  }
  if (game.mode === 'racing' && keys.drift && game.speed > 13) {
    lastSmoke += dt;
    if (lastSmoke > .055) {
      spawnSmoke(at);
      lastSmoke = 0;
    }
  }
  updateSmoke(dt);
  updateCamera(at, dt);
}

function drawMinimap() {
  const w = mapCanvas.width, h = mapCanvas.height;
  mapCtx.clearRect(0, 0, w, h);
  const coordinates = [];
  for (let i = 0; i <= 120; i++) {
    const point = curve.getPointAt(i / 120);
    coordinates.push([point.x, point.z]);
  }
  const xs = coordinates.map((p) => p[0]);
  const zs = coordinates.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const scale = Math.min((w - 26) / (maxX - minX), (h - 26) / (maxZ - minZ));
  const mapPoint = (point) => [
    w / 2 + (point.x - (minX + maxX) / 2) * scale,
    h / 2 + (point.z - (minZ + maxZ) / 2) * scale,
  ];
  mapCtx.beginPath();
  coordinates.forEach((point, i) => {
    const xy = mapPoint({ x: point[0], z: point[1] });
    if (i === 0) mapCtx.moveTo(...xy); else mapCtx.lineTo(...xy);
  });
  mapCtx.lineJoin = 'round'; mapCtx.lineCap = 'round';
  mapCtx.strokeStyle = '#173456'; mapCtx.lineWidth = 10; mapCtx.stroke();
  mapCtx.strokeStyle = '#e7faff'; mapCtx.lineWidth = 5; mapCtx.stroke();
  for (const ai of game.ai) {
    const point = mapPoint(pose(ai.distance).point);
    mapCtx.fillStyle = '#' + ai.color.toString(16).padStart(6, '0');
    mapCtx.beginPath(); mapCtx.arc(point[0], point[1], 3, 0, Math.PI * 2); mapCtx.fill();
  }
  const player = mapPoint(pose(game.distance).point);
  mapCtx.fillStyle = '#ffe238';
  mapCtx.beginPath(); mapCtx.arc(player[0], player[1], 5, 0, Math.PI * 2); mapCtx.fill();
}

function frame() {
  const dt = Math.min(.05, clock.getDelta());
  update(dt);
  if (game.mode !== 'menu') drawMinimap();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function keyToControl(key) {
  if (key === 'ArrowLeft' || key.toLowerCase() === 'a') return 'left';
  if (key === 'ArrowRight' || key.toLowerCase() === 'd') return 'right';
  if (key === 'ArrowUp' || key.toLowerCase() === 'w') return 'gas';
  if (key === ' ' || key === 'Spacebar') return 'drift';
  if (key === 'Shift') return 'boost';
  return null;
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
    if (!event.repeat) pauseRace();
    event.preventDefault(); return;
  }
  if (event.key === 'Enter' && game.mode === 'menu') {
    resetRace(); event.preventDefault(); return;
  }
  const control = keyToControl(event.key);
  if (control) { keys[control] = true; event.preventDefault(); }
});
window.addEventListener('keyup', (event) => {
  const control = keyToControl(event.key);
  if (control) { keys[control] = false; event.preventDefault(); }
});
window.addEventListener('blur', () => {
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  if (game.mode === 'racing') pauseRace();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'racing') pauseRace();
});
document.querySelectorAll('[data-control]').forEach((button) => {
  const control = button.dataset.control;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointerControls.set(event.pointerId, control);
    keys[control] = true;
    button.classList.add('active');
  });
  const release = (event) => {
    pointerControls.delete(event.pointerId);
    keys[control] = [...pointerControls.values()].includes(control);
    if (!keys[control]) button.classList.remove('active');
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});
$('#startButton').addEventListener('click', resetRace);
$('#againButton').addEventListener('click', resetRace);
$('#restartButton').addEventListener('click', resetRace);
$('#pauseButton').addEventListener('click', pauseRace);
$('#resumeButton').addEventListener('click', pauseRace);
window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

try {
  setup3D();
  frame();
} catch (error) {
  console.error(error);
  ui.menu.querySelector('p').textContent =
    'เบราว์เซอร์นี้เปิดภาพ 3D ไม่ได้ กรุณาลอง Chrome, Safari, Edge หรือ Firefox เวอร์ชันใหม่';
  $('#startButton').hidden = true;
}
