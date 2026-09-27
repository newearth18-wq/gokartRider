import * as THREE from './vendor/three.module.js';
import { TRACKS, CHARACTERS, MAX_PLAYERS, RACE_LAPS } from './config.js';
import { RaceConnection } from './network.js';
import { DEFAULT_QUESTIONS, MAX_QUESTIONS, normalizeQuestions } from './quiz.mjs';

const canvas = document.querySelector('#track');
const previewCanvas = document.querySelector('#garagePreview');
const $ = (selector) => document.querySelector(selector);
const ui = {
  menu: $('#menu'), pauseMenu: $('#pauseMenu'), results: $('#results'),
  hud: $('#hud'), touch: $('#touchControls'), pause: $('#pauseButton'),
  countdown: $('#countdown'), toast: $('#toast'), position: $('#position'),
  lap: $('#lap'), time: $('#time'), speed: $('#speed'),
  charge: $('#chargeValue'), chargeFill: $('#chargeFill'),
  boostHint: $('#boostHint'), resultPlace: $('#resultPlace'),
  resultSummary: $('#resultSummary'),
  lobby: $('#lobby'), lobbyCode: $('#lobbyCode'), lobbyCount: $('#lobbyCount'),
  lobbyPlayers: $('#lobbyPlayers'), lobbyDetails: $('#lobbyDetails'),
  lobbyStart: $('#lobbyStart'), roomBadge: $('#roomBadge'),
  networkStatus: $('#networkStatus'), leaderboard: $('#leaderboard'),
};
const mapCanvas = $('#minimap');
const mapCtx = mapCanvas.getContext('2d');
const keys = { left: false, right: false, gas: false, drift: false, boost: false };
const pointerControls = new Map();
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ROAD_HALF = 12.5;
const MAX_SPEED = 65;
const touchLayout = () => matchMedia('(any-pointer: coarse)').matches || window.innerWidth <= 700;
const AI_COLORS = [0xfa5b73, 0xffe25c, 0x48dec9, 0xa486f4, 0xff9a4d];
const clock = new THREE.Clock();
const up = new THREE.Vector3(0, 1, 0);
let renderer;
let scene;
let camera;
let curve;
let trackLength;
let playerKart;
let previewRenderer;
let previewScene;
let previewCamera;
let previewKart;
let opponents = [];
let smoke = [];
let lastSmoke = 0;
let toastUntil = 0;
let previousCountdown = '';
let selectedTrack = TRACKS[0];
let selectedCharacter = CHARACTERS[0];
const PAINTS = [0x188bef, 0xf75e6c, 0xffc52f, 0x58d2a0, 0x9a75ed, 0xf8f9ff, 0x1b2947];
const HELMETS = [0x258def, 0xff72aa, 0xffc33d, 0x51d9aa, 0x9478f5, 0xf7f7f1, 0x25385c];
const RIMS = [0xe3edf6, 0xffd84b, 0x5deaff, 0xff7aa8, 0xa58bff, 0x34394b];
const DECALS = [{ id: 'bolt', name: '⚡ สายฟ้า' }, { id: 'stripe', name: '▰ แถบ' }, { id: 'star', name: '★ ดาว' }, { id: 'plain', name: 'เรียบ' }];
let appearance = { paint: 0x188bef, helmet: 0x258def, rim: 0xe3edf6, decal: 'bolt' };
try {
  const saved = JSON.parse(localStorage.getItem('turbo-trail-garage') || '{}');
  if (PAINTS.includes(saved.paint)) appearance.paint = saved.paint;
  if (HELMETS.includes(saved.helmet)) appearance.helmet = saved.helmet;
  if (RIMS.includes(saved.rim)) appearance.rim = saved.rim;
  if (DECALS.some(item => item.id === saved.decal)) appearance.decal = saved.decal;
} catch { /* Private browsing can disable storage. */ }
let touchSteer = 0;
let steeringPointer = null;
let selectedMode = 'speed';
let onlineSelected = false;
let onlineRace = false;
let connectedPlayers = [];
let remoteKarts = new Map();
let lastNetworkState = 0;
let lastItem = -1;
let heldItem = null;
let earnedPower = null;
let learningEnabled = true;
let questionBank = DEFAULT_QUESTIONS.map(question => ({ ...question, options: [...question.options] }));
try { questionBank = normalizeQuestions(JSON.parse(localStorage.getItem('turbo-trail-questions') || 'null')); }
catch { /* Use the starter questions when storage is empty or invalid. */ }
let raceQuestions = questionBank;
let activeQuiz = null;
let nextQuizDistance = 180;
let quizCursor = 0;
let quizCorrect = 0;
let quizAttempted = 0;
let editingIndex = 0;
let shieldTime = 0;
let pulseTime = 0;
let lastLeaderboardUpdate = 0;
const network = new RaceConnection(onNetworkMessage, onNetworkClose);
let game = freshGame();

function freshGame() {
  return {
    mode: 'menu', countdown: 3, distance: 0, speed: 0, lateral: 0,
    steerMomentum: 0, heading: 0, lateralVelocity: 0,
    driftCharge: 0, boostTime: 0, raceTime: 0,
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
  const points = selectedTrack.points.map(([x, y, z]) => new THREE.Vector3(x * 1.8, y * 1.25, z * 1.8));
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

  const terrain = makeMaterial(selectedTrack.ground, 1);
  terrain.side = THREE.DoubleSide;
  ribbon(-155, 155, terrain, -.42);
  const verge = makeMaterial(selectedTrack.verge, 1);
  verge.side = THREE.DoubleSide;
  ribbon(-17, 17, verge, -.25);

  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = asphaltCanvas.height = 128;
  const asphalt = asphaltCanvas.getContext('2d');
  asphalt.fillStyle = '#' + selectedTrack.road.toString(16).padStart(6, '0');
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

  const railMaterial = makeMaterial(selectedTrack.rail, .45, .2);
  const railTop = makeMaterial(0xe6f3f7, .5);
  const postMatrices = [];
  for (const side of [-1, 1]) {
    const positions = [];
    for (let i = 0; i < count; i++) {
      const a = samples[i], b = samples[i + 1];
      for (const [p, y] of [[a, .35], [a, 1.05], [b, 1.05],
                            [a, .35], [b, 1.05], [b, .35]]) {
        const v = p.point.clone().addScaledVector(p.right, side * 15.5);
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
      const point = p.point.clone().addScaledVector(p.right, side * 15.5);
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
  for (let column = 0; column < 16; column++) {
    for (let row = 0; row < 2; row++) {
      const tile = box(scene, 1.55, .025, .9,
        (column + row) % 2 ? marker : makeMaterial(0x253444, 1),
        start.point.x, start.point.y + .09, start.point.z);
      const local = start.right.clone().multiplyScalar(-ROAD_HALF + .78 + column * 1.55)
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
  box(gantry, .9, 8.3, .9, cobalt, -14.5, 4.1, 0);
  box(gantry, .9, 8.3, .9, cobalt, 14.5, 4.1, 0);
  box(gantry, 30, 1.6, 1.2, cobalt, 0, 8.2, 0);
  const sign = mesh(new THREE.PlaneGeometry(16, 3.4), signMat, gantry, 0, 8.2, .66);
  sign.material.transparent = false;
  const backSign = mesh(new THREE.PlaneGeometry(16, 3.4), signMat, gantry, 0, 8.2, -.66);
  backSign.rotation.y = Math.PI;
  scene.add(gantry);
}

function createScenery() {
  const isCanyon = selectedTrack.decor === 'canyon';
  const isSnow = selectedTrack.decor === 'snow';
  const isHarbor = selectedTrack.decor === 'harbor';
  const vegetationCount = isHarbor ? 65 : isCanyon ? 95 : 175;
  const trunkGeo = new THREE.CylinderGeometry(.26, .38, 2.5, 6);
  const leafGeo = isSnow || isCanyon ?
    new THREE.ConeGeometry(isCanyon ? 1.25 : 2.3, isCanyon ? 4 : 5, 12) :
    new THREE.SphereGeometry(2.5, 12, 8);
  const foliage = new THREE.MeshLambertMaterial({ color: selectedTrack.foliage });
  const trunks = new THREE.InstancedMesh(trunkGeo, makeMaterial(isSnow ? 0x71888a : 0x7e624a, 1), vegetationCount);
  const crowns = new THREE.InstancedMesh(leafGeo, foliage, vegetationCount);
  const dummy = new THREE.Object3D();
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < vegetationCount; i++) {
    const sample = pose(trackLength * ((i * .61803398875) % 1));
    const side = i % 2 ? -1 : 1;
    const offset = side * (22 + random() * 52);
    const position = sample.point.clone().addScaledVector(sample.right, offset);
    const scale = .75 + random() * .8;
    dummy.position.set(position.x, position.y + scale * 1.15, position.z);
    dummy.rotation.y = random() * Math.PI;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = position.y + scale * (isCanyon ? 4.1 : 5.3);
    if (!isSnow && !isCanyon) dummy.scale.set(scale * 1.7, scale * 1.3, scale * 1.7);
    dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
  scene.add(trunks, crowns);

  const houseColors = isHarbor ? [0x66c9da, 0xffd075, 0xf8a09d, 0xe7e8f8] :
    isSnow ? [0xf2f8ff, 0xd6e8f2, 0xb5d8ec, 0xffffff] :
    isCanyon ? [0xc77a50, 0xd59c64, 0xe8b879, 0xb9644c] :
    [0xffcb73, 0xf7e5c0, 0x9ed9dd, 0xe89fa9];
  for (let i = 0; i < (isHarbor ? 45 : isCanyon ? 10 : 25); i++) {
    const at = pose(trackLength * ((i * .193 + .07) % 1));
    const side = i % 2 ? -1 : 1;
    const houseDistance = isSnow || isCanyon ? 42 + random() * 35 : 25 + random() * 28;
    const position = at.point.clone().addScaledVector(at.right, side * houseDistance);
    const home = new THREE.Group();
    home.position.copy(position);
    home.rotation.y = random() * Math.PI * 2;
    const wall = makeMaterial(houseColors[i % houseColors.length], .95);
    const height = isHarbor ? 7 + (i % 5) * 2.5 : 5;
    box(home, 6, height, 6, wall, 0, height / 2, 0);
    if (!isHarbor) {
      const roof = mesh(new THREE.ConeGeometry(5.2, 3, 4), makeMaterial(isSnow ? 0xeafaff : 0x9d6074), home, 0, height + 1.3, 0);
      roof.rotation.y = Math.PI / 4;
    }
    box(home, 1.7, 1.7, .08, makeMaterial(0x79cfe7), -1.3, 3.1, 3.05);
    box(home, 1.7, 1.7, .08, makeMaterial(0x79cfe7), 1.3, 3.1, 3.05);
    const trim = makeMaterial(isSnow ? 0xd2eaff : 0xfff2d6, .8);
    box(home, 1.95, .18, .16, trim, -1.3, 4.02, 3.16);
    box(home, 1.95, .18, .16, trim, 1.3, 4.02, 3.16);
    box(home, 1.4, 2.35, .12, makeMaterial(0x8e5f65, .8), 0, 1.2, 3.1);
    box(home, 6.6, .18, .4, trim, 0, .2, 3.1);
    scene.add(home);
  }

  const mountainMaterials = [selectedTrack.mountain,
    new THREE.Color(selectedTrack.mountain).multiplyScalar(.8),
    new THREE.Color(selectedTrack.mountain).lerp(new THREE.Color(0xffffff), .25)].map((color) => makeMaterial(color, 1));
  for (let i = 0; i < 22; i++) {
    const angle = i * Math.PI * 2 / 22;
    const radius = 350 + random() * 90;
    const size = (isCanyon ? 65 : 55) + random() * 55;
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
  if (isCanyon) {
    const rockColors = [0xb86d49, 0xc98150, 0xe0a56c].map(color => makeMaterial(color, 1));
    const caveMaterial = makeMaterial(0xa45f45, 1);
    for (let i = 0; i < 13; i++) {
      const at = pose(trackLength * .34 + i * 6);
      const arch = mesh(new THREE.TorusGeometry(14, 4.9, 8, 22), caveMaterial, scene,
        at.point.x, at.point.y + 9.5, at.point.z);
      arch.rotation.y = Math.atan2(at.tangent.x, at.tangent.z);
    }
    for (let i = 0; i < 45; i++) {
      const at = pose(trackLength * ((i * .137 + .03) % 1));
      const p = at.point.clone().addScaledVector(at.right, (i % 2 ? -1 : 1) * (24 + random() * 30));
      const rock = mesh(new THREE.DodecahedronGeometry(4 + random() * 5, 0), rockColors[i % 3], scene, p.x, p.y + 2, p.z);
      rock.scale.y = .65 + random() * 1.8;
    }
  }
  if (isSnow) {
    const ice = makeMaterial(0xe9faff, .4);
    for (let i = 0; i < 55; i++) {
      const at = pose(trackLength * ((i * .271 + .11) % 1));
      const p = at.point.clone().addScaledVector(at.right, (i % 2 ? -1 : 1) * (22 + random() * 40));
      mesh(new THREE.IcosahedronGeometry(2 + random() * 3, 0), ice, scene, p.x, p.y + 1, p.z);
    }
  }
  if (isHarbor) {
    const water = new THREE.MeshStandardMaterial({ color: 0x2aa9d0, roughness: .27, metalness: .12, transparent: true, opacity: .92 });
    for (const side of [-1, 1]) {
      const at = pose(trackLength * (side < 0 ? .14 : .65));
      const p = at.point.clone().addScaledVector(at.right, side * 122);
      mesh(new THREE.CircleGeometry(90, 64), water, scene, p.x, p.y - .20, p.z).rotation.x = -Math.PI / 2;
    }
  }
}

function createItemPickups() {
  const gold = makeMaterial(0xffd942, .25, .15);
  const blue = new THREE.MeshBasicMaterial({ color: 0x60f1ff, transparent: true, opacity: .55 });
  for (let distance = 170; distance < trackLength; distance += 170) {
    const at = pose(distance);
    const pickup = new THREE.Group();
    pickup.position.copy(at.point);
    pickup.position.y += 2.2;
    const diamond = mesh(new THREE.OctahedronGeometry(1.22, 0), gold, pickup);
    diamond.rotation.y = distance / 100;
    const halo = mesh(new THREE.TorusGeometry(1.5, .11, 8, 24), blue, pickup);
    halo.rotation.x = Math.PI / 2;
    scene.add(pickup);
  }
}

function createKart(color, character = selectedCharacter, lite = false, look = appearance) {
  const group = new THREE.Group();
  const chassis = new THREE.Group();
  group.add(chassis);
  const body = makeMaterial(color, .24, .17);
  const bodyLight = makeMaterial(new THREE.Color(color).lerp(new THREE.Color(0xffffff), .34), .25, .14);
  const dark = makeMaterial(0x172438, .55);
  const rubber = makeMaterial(0x172032, .92);
  const rim = makeMaterial(look.rim ?? 0xe3edf6, .25, .55);
  const skin = makeMaterial(0xffd5b3, .75);
  const helmet = makeMaterial(look.helmet ?? character.helmet, .24, .06);
  const suit = makeMaterial(character.suit, .5);
  const accent = makeMaterial(character.accent, .28);
  const eye = makeMaterial(0x14233b, .13);

  box(chassis, 2.6, .28, 3.7, dark, 0, .64, 0);
  const shell = mesh(new THREE.SphereGeometry(1, lite ? 12 : 24, lite ? 8 : 14), body, chassis, 0, .98, .1);
  shell.scale.set(1.55, .48, 2.22);
  const nose = mesh(new THREE.SphereGeometry(1, lite ? 10 : 22, lite ? 8 : 12), bodyLight, chassis, 0, .95, 1.34);
  nose.scale.set(.87, .34, 1.13);
  for (const x of [-1.25, 1.25]) {
    const pod = mesh(new THREE.SphereGeometry(1, lite ? 10 : 20, 10), body, chassis, x, .91, -.12);
    pod.scale.set(.48, .33, 1.36);
    const fender = mesh(new THREE.SphereGeometry(1, lite ? 10 : 18, 10), bodyLight, chassis, x, .83, 1.42);
    fender.scale.set(.44, .2, .66);
    box(chassis, .28, .08, .75, dark, x * .62, 1.31, -1.61);
  }
  const intake = mesh(new THREE.SphereGeometry(1, 12, 8), dark, chassis, 0, .73, 2.19);
  intake.scale.set(.55, .12, .1);
  const bumper = mesh(new THREE.SphereGeometry(1, 12, 8), accent, chassis, 0, .59, 2.27);
  bumper.scale.set(1.85, .17, .22);
  const rear = mesh(new THREE.SphereGeometry(1, 12, 8), dark, chassis, 0, .67, -2.0);
  rear.scale.set(1.7, .25, .24);
  box(chassis, 1.52, .7, 1.08, dark, 0, 1.20, -.52);
  box(chassis, 2.6, .13, .55, accent, 0, 1.5, -2.02);
  box(chassis, 2.3, .15, .22, accent, 0, 1.53, .78);
  const wheels = [];
  for (const x of [-1.62, 1.62]) {
    for (const z of [-1.35, 1.42]) {
      const mount = new THREE.Group();
      mount.position.set(x, .61, z);
      chassis.add(mount);
      const rolling = new THREE.Group();
      mount.add(rolling);
      const tire = mesh(new THREE.CylinderGeometry(.58, .58, .47, lite ? 10 : 24), rubber, rolling);
      tire.rotation.z = Math.PI / 2;
      const hub = mesh(new THREE.CylinderGeometry(.32, .32, .49, lite ? 10 : 20), rim, rolling,
        Math.sign(x) * .02);
      hub.rotation.z = Math.PI / 2;
      if (!lite) {
        const center = mesh(new THREE.CylinderGeometry(.15, .15, .51, 16), body, rolling,
          Math.sign(x) * .04);
        center.rotation.z = Math.PI / 2;
      }
      wheels.push({ mount, rolling, front: z > 0 });
    }
  }
  const driver = new THREE.Group();
  chassis.add(driver);
  const torso = mesh(new THREE.SphereGeometry(.65, lite ? 10 : 20, 12), suit, driver, 0, 1.87, -.65);
  torso.scale.set(1, .95, .83);
  const steeringWheel = mesh(new THREE.TorusGeometry(.35, .075, 8, 20), dark, chassis, 0, 1.68, .24);
  steeringWheel.rotation.x = -.5;
  box(chassis, .10, .10, .42, dark, 0, 1.58, .16);
  const chestBadge = mesh(new THREE.SphereGeometry(.19, 12, 8), accent, driver, 0, 1.92, -.07);
  chestBadge.scale.z = .25;
  const arms = [];
  for (const x of [-.56, .56]) {
    const arm = mesh(new THREE.SphereGeometry(.24, 12, 10), suit, driver, x, 1.82, -.19);
    arm.scale.set(.8, 1.35, .8);
    arms.push(arm);
    mesh(new THREE.SphereGeometry(.22, 12, 10), accent, driver, x * .75, 1.59, .07);
  }
  const head = new THREE.Group();
  driver.add(head);
  const helmetShell = mesh(new THREE.SphereGeometry(.79, lite ? 12 : 28, lite ? 10 : 20), helmet, head, 0, 2.55, -.67);
  helmetShell.scale.set(1.06, .94, 1.01);
  const face = mesh(new THREE.SphereGeometry(.65, lite ? 12 : 24, lite ? 8 : 16), skin, head, 0, 2.43, -.18);
  face.scale.set(1.0, .74, .40);
  for (const x of [-.25, .25]) {
    const e = mesh(new THREE.SphereGeometry(.12, 12, 10), eye, head, x, 2.54, .075);
    e.scale.set(.83, 1.5, .52);
    if (!lite) {
      const cheek = mesh(new THREE.SphereGeometry(.10, 10, 8), makeMaterial(0xf69caa, .7), head, x * 1.9, 2.3, .06);
      cheek.scale.set(1.15, .52, .42);
    }
  }
  const smile = mesh(new THREE.TorusGeometry(.12, .025, 6, 16, Math.PI), eye, head, 0, 2.22, .072);
  smile.rotation.z = Math.PI;
  if (character.style === 'bear' || character.style === 'ears' || character.style === 'fox') {
    for (const x of [-.55, .55]) {
      const ear = mesh(character.style === 'fox' ? new THREE.ConeGeometry(.27, .60, 12) :
        new THREE.SphereGeometry(.27, 12, 10), helmet, head, x, 3.18, -.68);
      if (character.style !== 'fox') ear.scale.y = .9;
    }
  } else if (character.style === 'buns') {
    for (const x of [-.72, .72]) mesh(new THREE.SphereGeometry(.32, 14, 12), helmet, head, x, 2.94, -.8);
  } else if (character.style === 'cap') {
    const brim = mesh(new THREE.SphereGeometry(1, 12, 8), accent, head, 0, 2.93, -.12);
    brim.scale.set(.72, .09, .43);
  } else {
    const stripe = mesh(new THREE.SphereGeometry(1, 12, 8), accent, head, 0, 3.21, -.67);
    stripe.scale.set(.12, .08, .69);
  }
  if (look.decal !== 'plain') {
    const badge = new THREE.Group();
    badge.position.set(0, 1.2, 1.96);
    chassis.add(badge);
    const mark = makeMaterial(look.decal === 'star' ? 0xffe65c : 0xfafcff, .28);
    if (look.decal === 'bolt') {
      const bolt = mesh(new THREE.BoxGeometry(.23, .055, .60), mark, badge);
      bolt.rotation.y = -.5;
    } else if (look.decal === 'stripe') {
      for (const x of [-.28, .28]) box(badge, .16, .055, .68, mark, x, 0, 0);
    } else {
      const star = mesh(new THREE.OctahedronGeometry(.3), mark, badge);
      star.scale.y = .18;
    }
  }
  if (!lite) {
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff3b9 });
    for (const x of [-1.12, 1.12]) {
      mesh(new THREE.SphereGeometry(.19, 12, 8), lamp, chassis, x, .92, 2.13);
      mesh(new THREE.SphereGeometry(.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff506d }), chassis, x, .82, -2.20);
    }
  }
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x60eaff, transparent: true, opacity: .9, depthWrite: false,
  });
  const flames = [];
  for (const x of [-.82, .82]) {
    const flame = mesh(new THREE.ConeGeometry(.24, 1.4, 8), flameMat, chassis, x, .65, -2.42);
    flame.rotation.x = -Math.PI / 2;
    flame.visible = false;
    flames.push(flame);
  }
  group.userData = { chassis, driver, head, arms, wheels, flames, lastDistance: 0, animationTime: 0 };
  scene.add(group);
  return group;
}

function setup3D() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(any-pointer: coarse)').matches ? 1.3 : 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.52;
  camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, .15, 640);
  previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  previewScene = new THREE.Scene();
  previewScene.add(new THREE.HemisphereLight(0xffffff, 0x7c9db7, 3));
  const previewLight = new THREE.DirectionalLight(0xffffff, 2.2);
  previewLight.position.set(-3, 9, 7);
  previewScene.add(previewLight);
  previewCamera = new THREE.PerspectiveCamera(26, 1, .1, 100);
  previewCamera.position.set(4.5, 3.7, 7.3);
  previewCamera.lookAt(0, 1.55, 0);
  resizePreview();
  buildWorld();
}

function resizePreview() {
  if (!previewRenderer) return;
  const width = Math.max(1, previewCanvas.clientWidth);
  const height = Math.max(1, previewCanvas.clientHeight);
  previewRenderer.setSize(width, height, false);
  previewCamera.aspect = width / height;
  previewCamera.updateProjectionMatrix();
}

function buildWorld() {
  if (previewKart) { previewScene.remove(previewKart); previewKart = null; }
  if (scene) {
    scene.traverse(object => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material?.dispose();
    });
  }
  scene = new THREE.Scene();
  scene.background = new THREE.Color(selectedTrack.sky);
  scene.fog = new THREE.FogExp2(selectedTrack.fog, .0023);
  scene.add(new THREE.HemisphereLight(0xe5faff, 0x6c9b61, 2.2));
  const sunlight = new THREE.DirectionalLight(0xffefc8, 2.3);
  sunlight.position.set(-90, 150, -40);
  scene.add(sunlight);
  createCurve();
  createRoad();
  createScenery();
  if (selectedMode === 'item') createItemPickups();
  playerKart = createKart(appearance.paint, selectedCharacter, false, appearance);
  previewKart = playerKart.clone(true);
  previewKart.position.set(0, 0, 0);
  previewKart.rotation.y = -.3;
  previewScene.add(previewKart);
  opponents = AI_COLORS.map((color, i) => {
    const character = CHARACTERS[(i + 1) % CHARACTERS.length];
    return createKart(color, character, true, { helmet: character.helmet, rim: 0xe3edf6, decal: 'stripe' });
  });
  opponents.forEach(kart => { kart.visible = false; });
  remoteKarts.clear();
  smoke = [];
  game = freshGame();
}

function syncKart(kart, distance, lateral, lean = 0, boost = false, heading = 0, speed = 0, dt = 0) {
  const at = pose(distance);
  kart.position.copy(at.point).addScaledVector(at.right, lateral);
  const parts = kart.userData;
  parts.animationTime += dt;
  const motion = Math.min(1, speed / MAX_SPEED);
  kart.position.y += .16 + Math.sin(parts.animationTime * (10 + speed * .24)) * .025 * motion;
  kart.rotation.y = Math.atan2(at.tangent.x, at.tangent.z) - heading;
  parts.chassis.rotation.z = lerp(parts.chassis.rotation.z, -lean * .19, Math.min(1, dt * 9));
  parts.chassis.rotation.x = lerp(parts.chassis.rotation.x, -motion * .025 - (boost ? .045 : 0), Math.min(1, dt * 5));
  parts.chassis.rotation.y = lerp(parts.chassis.rotation.y, lean * (boost ? .09 : .15), Math.min(1, dt * 7));
  parts.driver.position.y = Math.sin(parts.animationTime * (6 + motion * 5)) * .055 * (motion + .25);
  parts.driver.rotation.z = lerp(parts.driver.rotation.z, -lean * .16, Math.min(1, dt * 7));
  parts.head.rotation.z = lerp(parts.head.rotation.z, lean * .14, Math.min(1, dt * 5));
  parts.head.rotation.x = Math.sin(parts.animationTime * 3) * .025;
  parts.arms.forEach((arm, i) => { arm.rotation.z = lean * (i ? -.38 : .38); });
  for (const wheel of parts.wheels) {
    wheel.rolling.rotation.x += speed * dt / .58;
    if (wheel.front) wheel.mount.rotation.y = lerp(wheel.mount.rotation.y, -lean * .42, Math.min(1, dt * 12));
  }
  for (const flame of kart.userData.flames) {
    flame.visible = boost;
    if (boost) flame.scale.y = .7 + Math.random() * .7;
  }
  return at;
}

function syncRemoteKarts(dt) {
  const active = new Set();
  const visiblePlayers = connectedPlayers.filter(player => player.id !== network.id)
    .sort((a, b) => Math.abs(a.distance - game.distance) - Math.abs(b.distance - game.distance))
    .slice(0, 18);
  for (const player of visiblePlayers) {
    active.add(player.id);
    let kart = remoteKarts.get(player.id);
    if (!kart) {
      const color = /^#[0-9a-fA-F]{6}$/.test(player.kart || '') ? Number.parseInt(player.kart.slice(1), 16) : 0xff7f61;
      const character = CHARACTERS.find(entry => entry.id === player.character) || CHARACTERS[0];
      const helmet = /^#[0-9a-fA-F]{6}$/.test(player.helmet || '') ? Number.parseInt(player.helmet.slice(1), 16) : character.helmet;
      const rim = /^#[0-9a-fA-F]{6}$/.test(player.rim || '') ? Number.parseInt(player.rim.slice(1), 16) : 0xe3edf6;
      kart = createKart(color, character, true, { helmet, rim, decal: player.decal || 'bolt' });
      kart.userData.distance = player.distance;
      kart.userData.lateral = player.lateral;
      remoteKarts.set(player.id, kart);
    }
    kart.userData.distance = Math.abs(player.distance - kart.userData.distance) > 70 ?
      player.distance : lerp(kart.userData.distance, player.distance, Math.min(1, dt * 9));
    kart.userData.lateral = lerp(kart.userData.lateral, player.lateral, Math.min(1, dt * 9));
    syncKart(kart, kart.userData.distance, kart.userData.lateral, 0, player.boost, 0, player.speed || 0, dt);
  }
  for (const [id, kart] of remoteKarts) {
    if (active.has(id)) continue;
    scene.remove(kart);
    kart.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    remoteKarts.delete(id);
  }
}

function updateCamera(at, dt) {
  if (game.mode === 'menu') {
    const desired = at.point.clone().addScaledVector(at.tangent, 7)
      .addScaledVector(at.right, 6).add(new THREE.Vector3(0, 4.6, 0));
    const target = at.point.clone().addScaledVector(at.right, 3)
      .add(new THREE.Vector3(0, 1.65, 0));
    if (!game.cameraReady) { camera.position.copy(desired); game.cameraReady = true; }
    else camera.position.lerp(desired, Math.min(1, dt * 4));
    camera.lookAt(target);
    if (camera.fov !== 66) { camera.fov = 66; camera.updateProjectionMatrix(); }
    return;
  }
  const behind = at.tangent.clone().multiplyScalar(-12.8);
  const desired = at.point.clone().add(behind)
    .addScaledVector(at.right, game.lateral - game.lateralVelocity * .08)
    .add(new THREE.Vector3(0, 5.9 - Math.min(.6, game.speed / MAX_SPEED * .6), 0));
  const target = at.point.clone().addScaledVector(at.tangent, 19)
    .addScaledVector(at.right, game.lateral + game.steerMomentum * 2)
    .add(new THREE.Vector3(0, 1.8, 0));
  if (!game.cameraReady) {
    camera.position.copy(desired);
    game.cameraReady = true;
  } else camera.position.lerp(desired, 1 - Math.exp(-dt * 4.5));
  if (!game.cameraTarget) game.cameraTarget = target.clone();
  game.cameraTarget.lerp(target, 1 - Math.exp(-dt * 6));
  camera.lookAt(game.cameraTarget);
  camera.fov = lerp(camera.fov, 65 + game.speed / MAX_SPEED * 5 + (game.boostTime > 0 ? 4 : 0), Math.min(1, dt * 3));
  camera.updateProjectionMatrix();
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

function renderChoices() {
  $('#characterChoices').innerHTML = CHARACTERS.map(character =>
    `<button type="button" class="character-choice ${character.id === selectedCharacter.id ? 'active' : ''}" data-character="${character.id}" aria-pressed="${character.id === selectedCharacter.id}"><span class="face" style="background:#${character.helmet.toString(16).padStart(6, '0')}">${character.face}</span>${character.name}</button>`).join('');
  $('#trackChoices').innerHTML = TRACKS.map(track =>
    `<button type="button" class="track-choice ${track.id === selectedTrack.id ? 'active' : ''}" data-track="${track.id}" aria-pressed="${track.id === selectedTrack.id}"><span class="track-icon">${track.icon}</span><span><strong>${track.name}</strong><small>${track.subtitle}</small></span></button>`).join('');
  $('#characterCaption').textContent = `${selectedCharacter.name} · ${selectedCharacter.title}`;
  $('#trackCaption').textContent = selectedTrack.name;
  const colorGroups = [
    ['paint', PAINTS, '#paintChoices', 'สีรถ'],
    ['helmet', HELMETS, '#helmetChoices', 'สีหมวก'],
    ['rim', RIMS, '#rimChoices', 'สีล้อ'],
  ];
  for (const [part, colors, selector, label] of colorGroups) {
    $(selector).innerHTML = colors.map((color, index) =>
      `<button type="button" class="swatch ${appearance[part] === color ? 'active' : ''}" data-part="${part}" data-color="${color}" style="--swatch:#${color.toString(16).padStart(6, '0')}" aria-label="${label}แบบ ${index + 1}" aria-pressed="${appearance[part] === color}"></button>`).join('');
  }
  $('#decalChoices').innerHTML = DECALS.map(item =>
    `<button type="button" class="decal-choice ${appearance.decal === item.id ? 'active' : ''}" data-decal="${item.id}" aria-pressed="${appearance.decal === item.id}">${item.name}</button>`).join('');
  document.querySelectorAll('.race-mode').forEach(button => {
    button.classList.toggle('active', button.dataset.raceMode === selectedMode);
    button.setAttribute('aria-pressed', button.dataset.raceMode === selectedMode);
  });
}

function setOnlineSelection(enabled) {
  onlineSelected = enabled;
  $('#soloTab').classList.toggle('active', !enabled);
  $('#onlineTab').classList.toggle('active', enabled);
  $('#soloActions').hidden = enabled;
  $('#onlineActions').hidden = !enabled;
  if (enabled) ui.networkStatus.textContent = 'สร้างห้องหรือใส่รหัสห้องเพื่อแข่งกับเพื่อน สูงสุด 50 คน';
}

function setNetworkStatus(message, error = false) {
  ui.networkStatus.textContent = message;
  ui.networkStatus.classList.toggle('error', error);
}

function renderLobby(data) {
  if (!data || !network.room || data.code !== network.room) return;
  connectedPlayers = data.players || [];
  ui.lobbyCode.textContent = data.code;
  ui.lobbyCount.textContent = String(connectedPlayers.length);
  ui.lobbyDetails.textContent = `${TRACKS.find(track => track.id === data.track)?.name || 'สนาม'} · ${data.mode === 'item' ? 'ไอเท็มเรซ' : 'สปีดเรซ'}${data.learning ? ` · โหมดเรียนรู้ ${data.questions?.length || 0} ข้อ` : ''}`;
  ui.lobbyPlayers.replaceChildren(...connectedPlayers.map(player => {
    const badge = document.createElement('span');
    badge.className = 'lobby-player';
    badge.textContent = `${player.id === data.hostId ? '👑 ' : '🏎️ '}${player.name}`;
    return badge;
  }));
  ui.lobbyStart.hidden = data.hostId !== network.id;
  ui.roomBadge.textContent = `● ห้อง ${data.code} · ${connectedPlayers.length}/${MAX_PLAYERS}`;
  ui.roomBadge.hidden = false;
  if (data.state === 'lobby') {
    ui.menu.hidden = true;
    ui.lobby.hidden = false;
  } else if (data.state === 'countdown' && game.mode === 'menu') {
    selectedTrack = TRACKS.find(track => track.id === data.track) || TRACKS[0];
    selectedMode = data.mode;
    learningEnabled = Boolean(data.learning);
    $('#learningToggle').checked = learningEnabled;
    if (learningEnabled) raceQuestions = normalizeQuestions(data.questions);
    buildWorld();
    resetRace(true, data.startAt);
  }
}

function onNetworkMessage(data) {
  if (data.type === 'welcome' || data.type === 'room') renderLobby(data);
  if (data.type === 'snapshot') connectedPlayers = data.players || [];
  if (data.type === 'finish' && data.id === network.id && game.mode === 'finished') {
    ui.resultPlace.textContent = `${data.place}/${connectedPlayers.length}`;
  }
  if (data.type === 'item' && data.id !== network.id && data.item === 'pulse' && game.mode === 'racing') {
    const attacker = connectedPlayers.find(player => player.id === data.id);
    if (attacker && attacker.distance > game.distance && attacker.distance - game.distance < 90 && shieldTime <= 0) {
      pulseTime = 1.5;
      toast('โดนคลื่นพลัง! ⚡');
    }
  }
  if (data.type === 'error') setNetworkStatus(data.message, true);
}

function onNetworkClose() {
  ui.roomBadge.hidden = true;
  if (onlineRace && (game.mode === 'racing' || game.mode === 'countdown')) {
    onlineRace = false;
    toast('ขาดการเชื่อมต่อห้องแข่ง');
  } else if (!ui.lobby.hidden) {
    ui.lobby.hidden = true;
    ui.menu.hidden = false;
    setNetworkStatus('การเชื่อมต่อห้องแข่งสิ้นสุดแล้ว', true);
  }
}

async function connectRoom(action) {
  const code = $('#roomCode').value.trim().toUpperCase();
  if (action === 'join' && !/^[A-Z2-9]{5}$/.test(code)) return setNetworkStatus('กรอกรหัสห้อง 5 ตัวอักษร', true);
  if (action === 'create' && learningEnabled && new TextEncoder().encode(JSON.stringify(questionBank)).length > 9000)
    return setNetworkStatus('ชุดข้อสอบใหญ่เกิน 9 KB โปรดลดข้อความก่อนสร้างห้อง', true);
  setNetworkStatus('กำลังเชื่อมต่อเซิร์ฟเวอร์…');
  $('#createRoomButton').disabled = $('#joinRoomButton').disabled = true;
  try {
    const data = await network.connect(action, {
      code, name: $('#playerName').value, character: selectedCharacter.id,
      kart: `#${appearance.paint.toString(16).padStart(6, '0')}`,
      helmet: `#${appearance.helmet.toString(16).padStart(6, '0')}`,
      rim: `#${appearance.rim.toString(16).padStart(6, '0')}`,
      decal: appearance.decal,
      track: selectedTrack.id, mode: selectedMode,
      learning: learningEnabled, questions: learningEnabled ? questionBank : [],
    });
    renderLobby(data);
    setNetworkStatus(`เชื่อมต่อห้อง ${data.code} แล้ว`);
  } catch (error) { setNetworkStatus(error.message, true); }
  finally { $('#createRoomButton').disabled = $('#joinRoomButton').disabled = false; }
}

function resetRace(online = false, startAt = 0) {
  game = freshGame();
  onlineRace = online;
  if (!online) raceQuestions = questionBank;
  if (online) {
    const spawn = connectedPlayers.find(player => player.id === network.id);
    if (spawn) { game.distance = spawn.distance; game.lateral = spawn.lateral; }
  }
  game.mode = 'countdown';
  game.countdown = online ? Math.max(0, (startAt - Date.now()) / 1000) : 3;
  ui.menu.hidden = true;
  ui.lobby.hidden = true;
  ui.pauseMenu.hidden = true;
  ui.results.hidden = true;
  ui.hud.hidden = false;
  ui.touch.hidden = !touchLayout();
  ui.pause.hidden = online;
  ui.countdown.hidden = false;
  ui.toast.hidden = true;
  previousCountdown = '';
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  pointerControls.clear();
  resetTouchSteering();
  lastItem = 0; heldItem = null; shieldTime = 0; pulseTime = 0;
  earnedPower = null; activeQuiz = null; nextQuizDistance = 180;
  quizCursor = 0; quizCorrect = 0; quizAttempted = 0;
  $('#quizPanel').hidden = true;
  $('#learningScore').hidden = !learningEnabled;
  lastLeaderboardUpdate = 0;
  opponents.forEach(kart => { kart.visible = !online; });
  while (smoke.length) {
    const particle = smoke.pop();
    scene.remove(particle.puff);
    particle.puff.material.dispose();
  }
  updateHud();
}

function pauseRace() {
  if (activeQuiz) return;
  if (onlineRace) { toast('การแข่งขันออนไลน์หยุดเวลาไม่ได้'); return; }
  if (game.mode === 'racing' || game.mode === 'countdown') {
    game.wasCounting = game.mode === 'countdown';
    game.mode = 'paused';
    ui.pauseMenu.hidden = false;
    ui.countdown.hidden = true;
    Object.keys(keys).forEach((key) => { keys[key] = false; });
    resetTouchSteering();
  } else if (game.mode === 'paused') {
    game.mode = game.wasCounting ? 'countdown' : 'racing';
    ui.pauseMenu.hidden = true;
    ui.countdown.hidden = game.mode !== 'countdown';
  }
}

function finishRace() {
  game.mode = 'finished';
  if (onlineRace) network.send({ type: 'finish' });
  const place = rank();
  const suffix = place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
  ui.resultPlace.textContent = String(place) + suffix;
  ui.resultSummary.textContent = 'เวลา ' + formatTime(game.raceTime) + ' · ' +
    (place === 1 ? 'สุดยอด! คุณเป็นแชมป์สนามนี้' : 'ลองใหม่แล้วแซงให้ได้!') +
    (learningEnabled ? ` · ตอบถูก ${quizCorrect}/${quizAttempted} ข้อ` : '');
  ui.results.hidden = false;
  ui.touch.hidden = true;
  ui.pause.hidden = true;
  $('#againButton').firstChild.textContent = onlineRace ? 'กลับเมนู ' : 'แข่งอีกครั้ง ';
}

function returnToMenu() {
  network.close();
  setNetworkStatus('สร้างห้องหรือใส่รหัสห้องเพื่อแข่งกับเพื่อน สูงสุด 50 คน');
  onlineRace = false;
  connectedPlayers = [];
  ui.lobby.hidden = true;
  ui.pauseMenu.hidden = true;
  ui.results.hidden = true;
  $('#quizPanel').hidden = true;
  activeQuiz = null;
  ui.hud.hidden = true;
  ui.touch.hidden = true;
  ui.pause.hidden = true;
  ui.roomBadge.hidden = true;
  ui.menu.hidden = false;
  learningEnabled = $('#learningToggle').checked;
  buildWorld();
  renderChoices();
}

function toast(message, duration = 1.4) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastUntil = performance.now() + duration * 1000;
}

function showQuiz() {
  if (!learningEnabled || !raceQuestions.length || activeQuiz || game.mode !== 'racing') return;
  const index = quizCursor % raceQuestions.length;
  const question = raceQuestions[index];
  activeQuiz = { index, deadline: performance.now() + 20000 };
  if (!onlineRace) {
    game.mode = 'quiz';
    Object.keys(keys).forEach(key => { keys[key] = false; });
    resetTouchSteering();
  }
  $('#quizQuestion').textContent = question.question;
  $('#quizOptions').replaceChildren(...question.options.map((option, choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${'กขคง'[choice]}. ${option}`;
    button.addEventListener('click', () => answerQuiz(choice));
    return button;
  }));
  $('#quizTimer').textContent = onlineRace ? '20 วินาที' : 'หยุดเวลาแข่งชั่วคราว';
  $('#quizPanel').hidden = false;
  $('#quizOptions button')?.focus();
}

function answerQuiz(choice) {
  if (!activeQuiz) return;
  const question = raceQuestions[activeQuiz.index];
  if (choice !== null) {
    quizAttempted++;
    if (choice === question.answer) {
      quizCorrect++;
      earnedPower = ['nitro', 'shield', 'pulse'][(quizCorrect - 1) % 3];
      toast('ถูกต้อง! ได้พลังพิเศษ กด BOOST เพื่อใช้ ✨', 2.4);
    } else toast(`ยังไม่ถูก · คำตอบคือ ${question.options[question.answer]}`, 2.4);
  } else toast('ข้ามคำถามแล้ว', 1.2);
  quizCursor++;
  nextQuizDistance = Math.max(nextQuizDistance + 300, game.distance + 240);
  activeQuiz = null;
  $('#quizPanel').hidden = true;
  if (game.mode === 'quiz') game.mode = 'racing';
  updateHud();
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return m + ':' + s + '.' + Math.floor((seconds * 10) % 10);
}

function rank() {
  if (onlineRace) {
    const order = connectedPlayers.map(player => ({
      id: player.id, distance: player.id === network.id ? game.distance : player.distance,
    })).sort((a, b) => b.distance - a.distance);
    return Math.max(1, order.findIndex(player => player.id === network.id) + 1);
  }
  return 1 + game.ai.filter(opponent => opponent.distance > game.distance).length;
}

function updateLeaderboard() {
  const racers = onlineRace ? connectedPlayers.map(player => ({
    id: player.id, name: player.name, distance: player.id === network.id ? game.distance : player.distance,
  })) : [
    { id: 'me', name: selectedCharacter.name, distance: game.distance },
    ...game.ai.map((rival, i) => ({ id: `ai${i}`, name: CHARACTERS[(i + 1) % CHARACTERS.length].name, distance: rival.distance })),
  ];
  racers.sort((a, b) => b.distance - a.distance);
  const myId = onlineRace ? network.id : 'me';
  const myIndex = racers.findIndex(racer => racer.id === myId);
  const shown = racers.slice(0, 7);
  if (myIndex > 6) shown.push(racers[myIndex]);
  ui.leaderboard.replaceChildren(...shown.map(racer => {
    const li = document.createElement('li');
    const number = document.createElement('strong');
    number.textContent = String(racers.indexOf(racer) + 1);
    li.append(number, document.createTextNode(racer.name));
    if (racer.id === myId) li.className = 'mine';
    return li;
  }));
}

function updateHud() {
  if (performance.now() - lastLeaderboardUpdate > 450) {
    updateLeaderboard();
    lastLeaderboardUpdate = performance.now();
  }
  ui.position.innerHTML = String(rank()) + `<span>/ ${onlineRace ? Math.max(1, connectedPlayers.length) : 6}</span>`;
  ui.lap.innerHTML = String(Math.max(1, Math.min(RACE_LAPS, Math.floor(game.distance / trackLength) + 1))) +
    '<span>/ 3</span>';
  ui.time.textContent = formatTime(game.raceTime);
  ui.speed.textContent = String(Math.round(game.speed * 3.6));
  ui.charge.textContent = String(Math.floor(game.driftCharge)) + '%';
  ui.chargeFill.style.width = String(game.driftCharge) + '%';
  $('#quizScore').textContent = `${quizCorrect}/${quizAttempted}`;
  const ready = game.driftCharge >= 55 || Boolean(earnedPower || heldItem);
  const power = earnedPower || heldItem;
  ui.boostHint.textContent = power ? `${earnedPower ? 'พลังจากคำตอบ' : 'ไอเท็ม'}: ${power === 'nitro' ? 'ไนโตร' : power === 'shield' ? 'โล่' : 'คลื่นพลัง'} · กด BOOST` :
    game.boostTime > 0 ? 'TURBO ACTIVE!' :
    ready ? 'บูสต์พร้อมแล้ว!' : 'ดริฟต์เพื่อชาร์จบูสต์';
  $('.boost-button').classList.toggle('ready', ready);
}

function useBoost() {
  if ((earnedPower || (selectedMode === 'item' && heldItem)) && game.mode === 'racing') {
    const item = earnedPower || heldItem;
    if (earnedPower) earnedPower = null;
    else heldItem = null;
    if (item === 'nitro') { game.boostTime = 3.5; toast('ไนโตรแรงเต็มพิกัด! 🔥'); }
    else if (item === 'shield') { shieldTime = 7; toast('โล่ป้องกันพร้อม! 🛡️'); }
    else {
      pulseTime = 0;
      if (!onlineRace) game.ai.forEach(ai => { if (ai.distance > game.distance && ai.distance - game.distance < 90) ai.speed *= .72; });
      toast('ปล่อยคลื่นพลัง! ⚡');
    }
    if (onlineRace && (selectedMode === 'item' || learningEnabled)) network.send({ type: 'item', item });
    updateHud();
    return;
  }
  if (game.mode !== 'racing' || game.boostTime > 0 || game.driftCharge < 55) return;
  game.driftCharge -= 55;
  game.boostTime = 2.4;
  toast('TURBO BOOST! ⚡', 1.1);
}

function update(dt) {
  if (performance.now() > toastUntil) ui.toast.hidden = true;
  if (activeQuiz && onlineRace) {
    const remaining = Math.max(0, Math.ceil((activeQuiz.deadline - performance.now()) / 1000));
    $('#quizTimer').textContent = `${remaining} วินาที`;
    if (!remaining) answerQuiz(null);
  }
  if (game.mode === 'countdown') {
    game.countdown -= dt;
    const count = Math.min(3, Math.ceil(game.countdown));
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
    shieldTime = Math.max(0, shieldTime - dt);
    pulseTime = Math.max(0, pulseTime - dt);
    const accelerating = keys.gas || touchLayout();
    const steer = clamp(Number(keys.right) - Number(keys.left) + touchSteer, -1, 1);
    const drifting = keys.drift && Math.abs(steer) > 0 && game.speed > 13;
    const cap = game.boostTime > 0 ? MAX_SPEED * 1.3 : MAX_SPEED;
    game.speed += ((accelerating ? keys.gas ? 27 : 23 : -24) -
      game.speed * (game.boostTime > 0 ? .03 : .08)) * dt;
    if (pulseTime > 0) game.speed -= 26 * dt;
    if (game.boostTime > 0) {
      game.boostTime = Math.max(0, game.boostTime - dt);
      game.speed += 27 * dt;
    }
    if (Math.abs(game.lateral) > ROAD_HALF - 1.6 && shieldTime <= 0) {
      game.speed -= 33 * dt;
      if (!game.offRoadNotified) {
        toast('ออกนอกสนาม!');
        game.offRoadNotified = true;
      }
    } else game.offRoadNotified = false;
    game.speed = clamp(game.speed, 0, cap);
    const oldDistance = game.distance;
    game.distance += game.speed * Math.cos(game.heading) * dt;
    game.steerMomentum = lerp(game.steerMomentum, steer, 1 - Math.exp(-dt * (drifting ? 7 : 10)));
    const targetHeading = game.steerMomentum * (drifting ? .26 : .19) *
      (.48 + .52 * game.speed / MAX_SPEED) - clamp(game.lateral / ROAD_HALF, -1, 1) * .018;
    game.heading = lerp(game.heading, targetHeading, 1 - Math.exp(-dt * (drifting ? 3.7 : 6)));
    const targetSlide = game.speed * Math.sin(game.heading) * (drifting ? .49 : .43);
    game.lateralVelocity = lerp(game.lateralVelocity, targetSlide, 1 - Math.exp(-dt * (drifting ? 2.4 : 5)));
    game.lateral += game.lateralVelocity * dt;
    const before = pose(oldDistance).tangent;
    const after = pose(game.distance).tangent;
    const curveTurn = Math.atan2(before.x * after.z - before.z * after.x,
      before.x * after.x + before.z * after.z);
    game.heading = clamp(game.heading + curveTurn * (drifting ? .25 : .12), -.34, .34);
    if (Math.abs(game.lateral) > ROAD_HALF) {
      game.lateralVelocity += -Math.sign(game.lateral) * dt * 8;
    }
    game.lateral = clamp(game.lateral, -14.2, 14.2);
    if (drifting) game.driftCharge = clamp(game.driftCharge +
      dt * 38 * (.6 + game.speed / MAX_SPEED), 0, 100);
    for (const opponent of onlineRace ? [] : game.ai) {
      opponent.distance += opponent.speed * dt *
        (1 + Math.sin(game.raceTime * .32 + opponent.phase) * .045);
      opponent.lateral += (Math.sin(game.raceTime * .5 + opponent.phase) * 3.2 -
        opponent.lateral) * dt * .26;
      const gap = opponent.distance - game.distance;
      if (Math.abs(gap) < 3.3 && Math.abs(opponent.lateral - game.lateral) < 2.7 &&
          game.speed > 24) game.speed *= Math.max(.65, 1 - dt * 2);
    }
    if (onlineRace && shieldTime <= 0) {
      for (const rival of connectedPlayers) {
        if (rival.id !== network.id && Math.abs(rival.distance - game.distance) < 3 &&
            Math.abs(rival.lateral - game.lateral) < 2.4 && game.speed > 24) {
          game.speed *= Math.max(.68, 1 - dt * 1.8);
        }
      }
    }
    if (selectedMode === 'item') {
      const marker = Math.floor(game.distance / 170);
      if (marker > lastItem) {
        lastItem = marker;
        if (!heldItem) {
          heldItem = ['nitro', 'shield', 'pulse'][marker % 3];
          toast('เก็บไอเท็มแล้ว! 🎁');
        }
      }
    }
    if (learningEnabled && game.distance >= nextQuizDistance &&
        game.distance < trackLength * RACE_LAPS - 90) showQuiz();
    if (onlineRace) {
      lastNetworkState += dt;
      if (lastNetworkState >= .1) {
        lastNetworkState = 0;
        network.send({ type: 'state', distance: game.distance, lateral: game.lateral,
          speed: game.speed, boost: game.boostTime > 0, shield: shieldTime > 0 });
      }
    }
    if (game.distance >= trackLength * RACE_LAPS) {
      game.distance = trackLength * RACE_LAPS;
      finishRace();
    }
    updateHud();
  }

  const at = syncKart(playerKart, game.distance, game.lateral,
    game.steerMomentum * (keys.drift ? 1.5 : 1), game.boostTime > 0,
    game.heading, game.speed, dt);
  for (let i = 0; i < game.ai.length; i++) {
    const ai = game.ai[i];
    if (!onlineRace) syncKart(opponents[i], ai.distance, ai.lateral,
      Math.sin(game.raceTime * .7 + ai.phase) * .15, false, 0, ai.speed, dt);
  }
  if (onlineRace) syncRemoteKarts(dt);
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
  for (const rival of onlineRace ? connectedPlayers.filter(player => player.id !== network.id) : game.ai) {
    const point = mapPoint(pose(rival.distance).point);
    mapCtx.fillStyle = onlineRace ? rival.kart : '#' + rival.color.toString(16).padStart(6, '0');
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
  if (!ui.menu.hidden && previewRenderer) {
    previewKart.rotation.y = -.3 + Math.sin(performance.now() * .0006) * .15;
    previewRenderer.render(previewScene, previewCamera);
  }
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
  if (activeQuiz) {
    if (/^[1-4]$/.test(event.key)) answerQuiz(Number(event.key) - 1);
    else if (event.key === 'Escape') answerQuiz(null);
    if (/^[1-4]$/.test(event.key) || event.key === 'Escape') event.preventDefault();
    return;
  }
  if (!$('#questionEditor').hidden || !ui.menu.hidden || !ui.lobby.hidden) return;
  if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
    if (!event.repeat) pauseRace();
    event.preventDefault(); return;
  }
  const control = keyToControl(event.key);
  if (control) {
    keys[control] = true;
    if (control === 'boost' && !event.repeat) useBoost();
    event.preventDefault();
  }
});
window.addEventListener('keyup', (event) => {
  if (!$('#questionEditor').hidden) return;
  const control = keyToControl(event.key);
  if (control) { keys[control] = false; event.preventDefault(); }
});
window.addEventListener('blur', () => {
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  resetTouchSteering();
  if (game.mode === 'racing' && !onlineRace) pauseRace();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'racing' && !onlineRace) pauseRace();
});
document.querySelectorAll('[data-control]').forEach((button) => {
  const control = button.dataset.control;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointerControls.set(event.pointerId, control);
    keys[control] = true;
    if (control === 'boost') useBoost();
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
const steeringPad = $('#steeringPad');
function resetTouchSteering() {
  steeringPointer = null;
  touchSteer = 0;
  $('#steeringKnob').style.transform = 'translateX(0px)';
  steeringPad.setAttribute('aria-valuenow', '0');
}
function moveSteering(event) {
  const bounds = steeringPad.getBoundingClientRect();
  touchSteer = clamp((event.clientX - bounds.left - bounds.width / 2) / (bounds.width * .38), -1, 1);
  $('#steeringKnob').style.transform = `translateX(${touchSteer * bounds.width * .31}px)`;
  steeringPad.setAttribute('aria-valuenow', String(Math.round(touchSteer * 100)));
}
function releaseSteering(event) {
  if (steeringPointer !== event.pointerId) return;
  resetTouchSteering();
}
steeringPad.addEventListener('pointerdown', event => {
  event.preventDefault();
  steeringPointer = event.pointerId;
  steeringPad.setPointerCapture(event.pointerId);
  moveSteering(event);
});
steeringPad.addEventListener('pointermove', event => {
  if (steeringPointer === event.pointerId) moveSteering(event);
});
steeringPad.addEventListener('pointerup', releaseSteering);
steeringPad.addEventListener('pointercancel', releaseSteering);
steeringPad.addEventListener('lostpointercapture', releaseSteering);
steeringPad.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  touchSteer = clamp(touchSteer + (event.key === 'ArrowRight' ? .2 : -.2), -1, 1);
  $('#steeringKnob').style.transform = `translateX(${touchSteer * steeringPad.clientWidth * .31}px)`;
  steeringPad.setAttribute('aria-valuenow', String(Math.round(touchSteer * 100)));
});
$('#characterChoices').addEventListener('click', event => {
  const button = event.target.closest('[data-character]');
  if (!button || game.mode !== 'menu') return;
  selectedCharacter = CHARACTERS.find(character => character.id === button.dataset.character) || CHARACTERS[0];
  buildWorld(); renderChoices();
});

let editorDraft = [];
function editorStatus(message, error = false) {
  $('#editorStatus').textContent = message;
  $('#editorStatus').classList.toggle('error', error);
}
function collectEditor() {
  if (!editorDraft.length) return;
  editorDraft[editingIndex] = {
    question: $('#questionText').value,
    options: [...document.querySelectorAll('.question-option')].map(input => input.value),
    answer: Number($('#correctAnswer').value),
  };
}
function renderEditor() {
  $('#questionSelect').replaceChildren(...editorDraft.map((item, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${index + 1}. ${(item.question || 'ข้อใหม่').slice(0, 36)}`;
    return option;
  }));
  $('#questionSelect').value = String(editingIndex);
  const item = editorDraft[editingIndex];
  $('#questionText').value = item.question;
  document.querySelectorAll('.question-option').forEach((input, index) => { input.value = item.options[index] || ''; });
  $('#correctAnswer').value = String(item.answer);
  $('#addQuestion').disabled = editorDraft.length >= MAX_QUESTIONS;
  $('#deleteQuestion').disabled = editorDraft.length <= 1;
}
function openEditor() {
  editorDraft = questionBank.map(item => ({ ...item, options: [...item.options] }));
  editingIndex = 0;
  renderEditor();
  editorStatus(`มีข้อสอบ ${editorDraft.length} ข้อ · บันทึกไว้ในเบราว์เซอร์เครื่องนี้`);
  $('#questionEditor').hidden = false;
}
$('#editQuestionsButton').addEventListener('click', openEditor);
$('#closeEditor').addEventListener('click', () => { $('#questionEditor').hidden = true; });
$('#questionSelect').addEventListener('change', event => {
  collectEditor();
  editingIndex = Number(event.target.value);
  renderEditor();
});
$('#addQuestion').addEventListener('click', () => {
  collectEditor();
  if (editorDraft.length >= MAX_QUESTIONS) return;
  editorDraft.push({ question: '', options: ['', '', '', ''], answer: 0 });
  editingIndex = editorDraft.length - 1;
  renderEditor();
  $('#questionText').focus();
});
$('#deleteQuestion').addEventListener('click', () => {
  if (editorDraft.length <= 1) return;
  editorDraft.splice(editingIndex, 1);
  editingIndex = Math.min(editingIndex, editorDraft.length - 1);
  renderEditor();
});
$('#saveQuestions').addEventListener('click', () => {
  collectEditor();
  try {
    questionBank = normalizeQuestions(editorDraft);
    localStorage.setItem('turbo-trail-questions', JSON.stringify(questionBank));
    editorStatus(`บันทึกแล้ว ${questionBank.length} ข้อ · ใช้ในการแข่งครั้งถัดไป`);
    renderEditor();
  } catch (error) { editorStatus(error.message, true); }
});
$('#exportQuestions').addEventListener('click', () => {
  collectEditor();
  try {
    const questions = normalizeQuestions(editorDraft);
    const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'turbo-trail-questions.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    editorStatus(`ส่งออกข้อสอบ ${questions.length} ข้อแล้ว`);
  } catch (error) { editorStatus(error.message, true); }
});
$('#importQuestions').addEventListener('click', () => $('#questionFile').click());
$('#questionFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 15000) throw new Error('ไฟล์ข้อสอบใหญ่เกิน 15 KB');
    editorDraft = normalizeQuestions(JSON.parse(await file.text()));
    editingIndex = 0;
    renderEditor();
    editorStatus(`นำเข้า ${editorDraft.length} ข้อแล้ว · กดบันทึกข้อสอบเพื่อใช้งาน`);
  } catch (error) { editorStatus(error.message, true); }
  event.target.value = '';
});
$('#learningToggle').addEventListener('change', event => { learningEnabled = event.target.checked; });
$('#skipQuestion').addEventListener('click', () => answerQuiz(null));
$('#garage').addEventListener('click', event => {
  const swatch = event.target.closest('[data-part][data-color]');
  const decal = event.target.closest('[data-decal]');
  if (swatch) appearance[swatch.dataset.part] = Number(swatch.dataset.color);
  else if (decal) appearance.decal = decal.dataset.decal;
  else return;
  try { localStorage.setItem('turbo-trail-garage', JSON.stringify(appearance)); } catch { /* Storage is optional. */ }
  buildWorld(); renderChoices();
});
$('#trackChoices').addEventListener('click', event => {
  const button = event.target.closest('[data-track]');
  if (!button || game.mode !== 'menu') return;
  selectedTrack = TRACKS.find(track => track.id === button.dataset.track) || TRACKS[0];
  buildWorld(); renderChoices();
});
document.querySelectorAll('[data-race-mode]').forEach(button => button.addEventListener('click', () => {
  selectedMode = button.dataset.raceMode; buildWorld(); renderChoices();
}));
$('#soloTab').addEventListener('click', () => setOnlineSelection(false));
$('#onlineTab').addEventListener('click', () => setOnlineSelection(true));
$('#createRoomButton').addEventListener('click', () => connectRoom('create'));
$('#joinRoomButton').addEventListener('click', () => connectRoom('join'));
$('#lobbyStart').addEventListener('click', () => network.send({ type: 'start' }));
$('#lobbyLeave').addEventListener('click', returnToMenu);
$('#startButton').addEventListener('click', () => resetRace(false));
$('#againButton').addEventListener('click', () => onlineRace ? returnToMenu() : resetRace(false));
$('#restartButton').addEventListener('click', () => resetRace(false));
$('#pauseButton').addEventListener('click', pauseRace);
$('#resumeButton').addEventListener('click', pauseRace);
window.addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  resizePreview();
});

try {
  renderChoices();
  setup3D();
  frame();
} catch (error) {
  console.error(error);
  ui.menu.querySelector('p').textContent =
    'เบราว์เซอร์นี้เปิดภาพ 3D ไม่ได้ กรุณาลอง Chrome, Safari, Edge หรือ Firefox เวอร์ชันใหม่';
  $('#startButton').hidden = true;
}
