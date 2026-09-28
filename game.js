import * as THREE from './vendor/three.module.js';
import { TRACKS, CHARACTERS, KARTS, MAX_PLAYERS, RACE_LAPS } from './config.js?v=10-0';
import { settleRoadEdge, steerThroughCurve } from './driving.mjs?v=10-0';
import { RaceConnection } from './network.js';
import { DEFAULT_QUESTIONS, MAX_QUESTIONS, normalizeQuestions } from './quiz.mjs';
import { qrcode } from './vendor/qrcode.mjs';
import { GameAudio } from './audio.js?v=9-0';

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
const ROAD_HALF = 17.5;
const FIRST_QUIZ_DISTANCE = 250;
const QUIZ_INTERVAL = 850;
const POWERS = {
  nitro: { icon: '🚀', name: 'ไนโตร', detail: 'พุ่งเร็ว 3.5 วินาที' },
  shield: { icon: '🛡️', name: 'เกราะป้องกัน', detail: 'กันชนและขอบสนาม 7 วินาที' },
  pulse: { icon: '⚡', name: 'คลื่นพลัง', detail: 'ชะลอคู่แข่งด้านหน้า' },
  banana: { icon: '🍌', name: 'เปลือกกล้วย', detail: 'ทิ้งไว้ให้เพื่อนที่ตามมาลื่น' },
  ball: { icon: '🏐', name: 'ลูกบอลเด้ง', detail: 'ยิงใส่เพื่อนที่อยู่ใกล้' },
  pie: { icon: '🥧', name: 'พายครีม', detail: 'ปาพายใส่เพื่อนให้เสียจังหวะ' },
};
const QUIZ_REWARDS = ['ball', 'shield', 'banana', 'pie', 'nitro', 'pulse'];
const ITEM_REWARDS = ['nitro', 'banana', 'ball', 'shield', 'pie', 'pulse'];
const MAX_SPEED = 65;
const touchLayout = () => matchMedia('(any-pointer: coarse)').matches || window.innerWidth <= 700;
const AI_COLORS = [0xfa5b73, 0xffe25c, 0x48dec9, 0xa486f4, 0xff9a4d, 0x68b5ff, 0xf58ad5];
const clock = new THREE.Clock();
const audio = new GameAudio();
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
let selectedKart = KARTS[0];
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
  selectedKart = KARTS.find(kart => kart.id === saved.model) || KARTS[0];
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
let nextQuizDistance = FIRST_QUIZ_DISTANCE;
let quizCursor = 0;
let quizCorrect = 0;
let quizAttempted = 0;
let editingIndex = 0;
let shieldTime = 0;
let pulseTime = 0;
let hitTime = 0;
let hitKind = null;
let bananaTraps = [];
let projectiles = [];
let lastLeaderboardUpdate = 0;
let renderedRoomQr = '';
let scannerStream = null;
let scannerTimer = null;
let scannerActive = false;
let scannerDetector = null;
let studentInviteCode = null;
const network = new RaceConnection(onNetworkMessage, onNetworkClose);
let game = freshGame();

function freshGame() {
  return {
    mode: 'menu', countdown: 3, distance: 0, speed: 0, lateral: 0,
    steerMomentum: 0, heading: 0, lateralVelocity: 0,
    driftCharge: 0, boostTime: 0, raceTime: 0,
    offRoadNotified: false, cameraReady: false,
    ai: AI_COLORS.map((color, i) => ({
      color, distance: 9 + i * 6, lateral: [-3, 2, .1, -2, 3, -1, 1][i],
      speed: 45 + i * 1.8, phase: i * 1.7,
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
  const points = selectedTrack.points.map(([x, y, z]) => new THREE.Vector3(x * 2.5, y * 1.25, z * 2.5));
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
  ribbon(-ROAD_HALF - 8, ROAD_HALF + 8, verge, -.25);

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
        const v = p.point.clone().addScaledVector(p.right, side * (ROAD_HALF + 3));
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
      const point = p.point.clone().addScaledVector(p.right, side * (ROAD_HALF + 3));
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
  for (let column = 0; column < Math.floor((ROAD_HALF * 2 - 1.5) / 1.55); column++) {
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
  box(gantry, .9, 8.3, .9, cobalt, -(ROAD_HALF + 4), 4.1, 0);
  box(gantry, .9, 8.3, .9, cobalt, ROAD_HALF + 4, 4.1, 0);
  box(gantry, (ROAD_HALF + 4) * 2 + 1, 1.6, 1.2, cobalt, 0, 8.2, 0);
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
  const roadPoints = Array.from({ length: 300 }, (_, i) => curve.getPointAt(i / 300));
  const minX = Math.min(...roadPoints.map(point => point.x));
  const maxX = Math.max(...roadPoints.map(point => point.x));
  const minZ = Math.min(...roadPoints.map(point => point.z));
  const maxZ = Math.max(...roadPoints.map(point => point.z));
  const mapCenterX = (minX + maxX) / 2;
  const mapCenterZ = (minZ + maxZ) / 2;
  function clearOfRoad(point, radius) {
    const limit = (ROAD_HALF + radius + 4) ** 2;
    for (let i = 0; i < roadPoints.length; i++) {
      const a = roadPoints[i], b = roadPoints[(i + 1) % roadPoints.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const x = a.x + dx * t, z = a.z + dz * t;
      if ((point.x - x) ** 2 + (point.z - z) ** 2 < limit) return false;
    }
    return true;
  }
  function roadside(at, side, initialDistance, radius) {
    let position;
    for (let distance = initialDistance; distance < 650; distance += 12) {
      position = at.point.clone().addScaledVector(at.right, side * distance);
      if (clearOfRoad(position, radius)) return position;
    }
    return position;
  }
  const vegetationCount = isHarbor ? 65 : isCanyon ? 95 : 175;
  const trunkGeo = new THREE.CylinderGeometry(.26, .38, 2.5, 6);
  const leafGeo = isSnow || isCanyon ?
    new THREE.ConeGeometry(isCanyon ? 1.25 : 2.3, isCanyon ? 4 : 5, 12) :
    new THREE.SphereGeometry(2.5, 12, 8);
  const foliage = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunks = new THREE.InstancedMesh(trunkGeo, makeMaterial(isSnow ? 0x71888a : 0x7e624a, 1), vegetationCount);
  const crowns = new THREE.InstancedMesh(leafGeo, foliage, vegetationCount);
  const dummy = new THREE.Object3D();
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < vegetationCount; i++) {
    const sample = pose(trackLength * ((i * .61803398875) % 1));
    const side = i % 2 ? -1 : 1;
    const position = roadside(sample, side, ROAD_HALF + 13 + random() * 52, 5);
    const scale = .75 + random() * .8;
    dummy.position.set(position.x, position.y + scale * 1.15, position.z);
    dummy.rotation.y = random() * Math.PI;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = position.y + scale * (isCanyon ? 4.1 : 5.3);
    if (!isSnow && !isCanyon) dummy.scale.set(scale * 1.7, scale * 1.3, scale * 1.7);
    dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
    const leafColor = new THREE.Color(selectedTrack.foliage);
    leafColor.offsetHSL((random() - .5) * .09, random() * .12, (random() - .5) * .20);
    crowns.setColorAt(i, leafColor);
  }
  trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
  crowns.instanceColor.needsUpdate = true;
  scene.add(trunks, crowns);

  const pennantColors = [0xffde42, 0xff6c9b, 0x4de9eb, 0x926dff].map(color => makeMaterial(color, .45));
  const poleMaterial = makeMaterial(0xf3f9ff, .45);
  for (let i = 0; i < 34; i++) {
    const at = pose(trackLength * (i + .35) / 34);
    const side = i % 2 ? -1 : 1;
    const position = roadside(at, side, ROAD_HALF + 8, 2);
    const flag = new THREE.Group();
    flag.position.copy(position);
    flag.rotation.y = Math.atan2(at.tangent.x, at.tangent.z);
    box(flag, .12, 3.2, .12, poleMaterial, 0, 1.6, 0);
    box(flag, 1.65, .85, .07, pennantColors[i % pennantColors.length], side * .82, 2.69, 0);
    scene.add(flag);
  }

  const houseColors = isHarbor ? [0x66c9da, 0xffd075, 0xf8a09d, 0xe7e8f8] :
    isSnow ? [0xf2f8ff, 0xd6e8f2, 0xb5d8ec, 0xffffff] :
    isCanyon ? [0xc77a50, 0xd59c64, 0xe8b879, 0xb9644c] :
    [0xffcb73, 0xf7e5c0, 0x9ed9dd, 0xe89fa9];
  for (let i = 0; i < (isHarbor ? 45 : isCanyon ? 10 : 25); i++) {
    const at = pose(trackLength * ((i * .193 + .07) % 1));
    const side = i % 2 ? -1 : 1;
    const houseDistance = isSnow || isCanyon ? ROAD_HALF + 27 + random() * 35 : ROAD_HALF + 18 + random() * 28;
    const position = roadside(at, side, houseDistance, 6);
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
    const size = (isCanyon ? 65 : 55) + random() * 55;
    const directionX = Math.cos(angle), directionZ = Math.sin(angle);
    const outerRoad = Math.max(...roadPoints.map(point =>
      (point.x - mapCenterX) * directionX + (point.z - mapCenterZ) * directionZ));
    const radius = outerRoad + size + ROAD_HALF + 75 + random() * 35;
    const mountain = mesh(new THREE.ConeGeometry(size, size * 1.2, 5),
      mountainMaterials[i % mountainMaterials.length], scene,
      mapCenterX + directionX * radius, size * .42 - 9, mapCenterZ + directionZ * radius);
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
      const arch = mesh(new THREE.TorusGeometry(ROAD_HALF + 8, 3.2, 8, 22), caveMaterial, scene,
        at.point.x, at.point.y + 9.5, at.point.z);
      arch.rotation.y = Math.atan2(at.tangent.x, at.tangent.z);
    }
    for (let i = 0; i < 45; i++) {
      const at = pose(trackLength * ((i * .137 + .03) % 1));
      const p = roadside(at, i % 2 ? -1 : 1, ROAD_HALF + 12 + random() * 30, 8);
      const rock = mesh(new THREE.DodecahedronGeometry(4 + random() * 5, 0), rockColors[i % 3], scene, p.x, p.y + 2, p.z);
      rock.scale.y = .65 + random() * 1.8;
    }
  }
  if (isSnow) {
    const ice = makeMaterial(0xe9faff, .4);
    for (let i = 0; i < 55; i++) {
      const at = pose(trackLength * ((i * .271 + .11) % 1));
      const p = roadside(at, i % 2 ? -1 : 1, ROAD_HALF + 10 + random() * 40, 4);
      mesh(new THREE.IcosahedronGeometry(2 + random() * 3, 0), ice, scene, p.x, p.y + 1, p.z);
    }
  }
  if (isHarbor) {
    const water = new THREE.MeshStandardMaterial({ color: 0x2aa9d0, roughness: .27, metalness: .12, transparent: true, opacity: .92 });
    for (const side of [-1, 1]) {
      const at = pose(trackLength * (side < 0 ? .14 : .65));
      const p = roadside(at, side, 122, 90);
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
  const highlight = makeMaterial(0xffdf45, .22, .08);
  const white = makeMaterial(0xffffff, .18);
  const eye = makeMaterial(0x14233b, .13);
  const model = KARTS.find(kart => kart.id === look.model) || KARTS[0];
  const trim = makeMaterial(model.trim, .28, .14);

  box(chassis, 2.6, .28, 3.7, dark, 0, .64, 0);
  const shell = mesh(new THREE.SphereGeometry(1, lite ? 12 : 24, lite ? 8 : 14), body, chassis, 0, .98, .1);
  const shellSize = {
    grip: [1.78, .68, 1.83], rocket: [1.18, .48, 2.42], flash: [1.29, .31, 2.55],
    bubble: [1.72, .82, 1.79], shark: [1.20, .43, 2.59], hover: [1.51, .31, 1.92],
  }[model.style] || [1.55, .48, 2.22];
  shell.scale.set(...shellSize);
  const centerStripe = mesh(new THREE.SphereGeometry(1, lite ? 10 : 20, 10), trim, chassis, 0, 1.39, .12);
  centerStripe.scale.set(model.style === 'grip' ? .48 : .35, .05, model.style === 'grip' ? 1.35 : 1.71);
  const nose = mesh(new THREE.SphereGeometry(1, lite ? 10 : 22, lite ? 8 : 12), bodyLight, chassis, 0, .95, 1.34);
  const noseSize = {
    rocket: [.70, .34, 1.47], grip: [1.08, .48, 1.13], flash: [.67, .34, 1.60],
    bubble: [1.02, .50, 1.00], shark: [.57, .32, 1.78], hover: [.95, .23, 1.20],
  }[model.style] || [.87, .34, 1.13];
  nose.scale.set(...noseSize);
  const noseStripe = mesh(new THREE.SphereGeometry(1, 16, 10), highlight, chassis, 0, 1.20, 1.66);
  noseStripe.scale.set(.17, .035, .72);
  for (const x of [-1.25, 1.25]) {
    const pod = mesh(new THREE.SphereGeometry(1, lite ? 10 : 20, 10), body, chassis, x, .91, -.12);
    pod.scale.set(model.style === 'grip' ? .60 : model.style === 'rocket' ? .33 : .48,
      model.style === 'grip' ? .48 : .33, model.style === 'flash' ? 1.62 : 1.36);
    const podStripe = mesh(new THREE.SphereGeometry(1, 12, 8), accent, chassis, x, 1.14, -.1);
    podStripe.scale.set(.25, .045, 1.06);
    const fender = mesh(new THREE.SphereGeometry(1, lite ? 10 : 18, 10), bodyLight, chassis, x, .83, 1.42);
    fender.scale.set(.44, .2, .66);
    box(chassis, .28, .08, .75, dark, x * .62, 1.31, -1.61);
  }
  const intake = mesh(new THREE.SphereGeometry(1, 12, 8), dark, chassis, 0, .73, 2.19);
  intake.scale.set(.55, .12, .1);
  const bumper = mesh(new THREE.SphereGeometry(1, 12, 8), trim, chassis, 0, .59, 2.27);
  bumper.scale.set(1.85, .17, .22);
  const rear = mesh(new THREE.SphereGeometry(1, 12, 8), dark, chassis, 0, .67, -2.0);
  rear.scale.set(1.7, .25, .24);
  box(chassis, 1.52, .7, 1.08, dark, 0, 1.20, -.52);
  box(chassis, 2.6, .13, .55, accent, 0, 1.5, -2.02);
  box(chassis, 2.3, .15, .22, accent, 0, 1.53, .78);
  if (model.style === 'rocket') {
    box(chassis, 3.6, .15, .70, trim, 0, 1.85, -2.0);
    for (const x of [-1.24, 1.24]) {
      const wing = mesh(new THREE.ConeGeometry(.57, 2.1, 4), bodyLight, chassis, x, 1.0, -.82);
      wing.rotation.x = Math.PI / 2;
      box(chassis, .28, 1.05, 1.24, trim, x * 1.25, 1.60, -1.75);
      const jet = mesh(new THREE.CylinderGeometry(.38, .52, .96, 12), dark, chassis, x * .72, .91, -2.30);
      jet.rotation.x = Math.PI / 2;
      const glow = mesh(new THREE.CircleGeometry(.33, 12), trim, chassis, x * .72, .91, -2.85);
      glow.rotation.y = Math.PI;
    }
    const noseCone = mesh(new THREE.ConeGeometry(.60, 1.70, 12), trim, chassis, 0, 1.08, 2.73);
    noseCone.rotation.x = Math.PI / 2;
  } else if (model.style === 'grip') {
    for (const x of [-1.4, 1.4]) {
      box(chassis, .63, .49, 1.75, trim, x * 1.19, .99, 1.02);
      box(chassis, .48, .16, 1.38, dark, x * 1.19, 1.31, 1.02);
      box(chassis, .24, 1.22, .25, trim, x * .90, 2.21, -1.50);
    }
    box(chassis, 3.8, .33, .60, trim, 0, 1.20, -1.99);
    box(chassis, 1.58, .19, .26, trim, 0, 2.87, -1.50);
    box(chassis, 3.95, .36, .34, dark, 0, .78, 2.22);
    for (const x of [-1.55, 1.55]) mesh(new THREE.SphereGeometry(.22, 10, 8), highlight, chassis, x, 1.13, 2.29);
  } else if (model.style === 'flash') {
    for (const x of [-1, 1]) {
      const blade = box(chassis, .24, .13, 1.95, trim, x * 1.22, 1.21, .82);
      blade.rotation.y = x * .28;
      const wing = box(chassis, 1.18, .13, .44, trim, x * 1.35, .78, 1.93);
      wing.rotation.y = x * -.22;
      box(chassis, .16, .37, .56, dark, x * 2.04, .84, 2.63);
    }
    box(chassis, 3.55, .18, .45, trim, 0, 1.77, -2.15);
    box(chassis, .66, .12, 1.44, trim, 0, 1.43, 1.42);
    box(chassis, 4.18, .14, .54, trim, 0, .68, 2.64);
    box(chassis, .48, .26, 1.26, bodyLight, 0, .92, 2.25);
  } else if (model.style === 'bubble') {
    const bumperRing = mesh(new THREE.TorusGeometry(1.85, .22, 8, 40), trim, chassis, 0, .88, .16);
    bumperRing.rotation.x = Math.PI / 2;
    bumperRing.scale.y = 1.05;
    const canopy = mesh(new THREE.SphereGeometry(1.19, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xa8f6ff, roughness: .12, metalness: .08,
        transparent: true, opacity: .23, depthWrite: false, side: THREE.DoubleSide }), chassis,
      0, 2.19, -.51);
    canopy.scale.set(1.04, 1.03, 1.10);
    const canopyBand = mesh(new THREE.TorusGeometry(1.17, .09, 8, 32), trim, chassis, 0, 1.83, -.51);
    canopyBand.rotation.x = Math.PI / 2;
    for (const x of [-1.48, 1.48]) {
      const sideBubble = mesh(new THREE.SphereGeometry(.60, 14, 10), bodyLight, chassis, x, .93, -.77);
      sideBubble.scale.set(.62, .70, 1.05);
    }
  } else if (model.style === 'shark') {
    const snout = mesh(new THREE.ConeGeometry(.57, 1.58, 12), bodyLight, chassis, 0, .97, 2.85);
    snout.rotation.x = Math.PI / 2;
    const fin = mesh(new THREE.ConeGeometry(.74, 2.05, 3), trim, chassis, 0, 2.89, -1.63);
    fin.rotation.y = Math.PI / 2;
    for (const x of [-1, 1]) {
      const sideFin = box(chassis, 1.43, .12, .78, trim, x * 1.28, .94, -.83);
      sideFin.rotation.y = x * .38;
      const tail = box(chassis, .13, 1.05, .85, trim, x * .67, 1.70, -2.13);
      tail.rotation.z = x * .48;
      for (const z of [.65, .90, 1.15]) box(chassis, .08, .30, .09, dark, x * 1.16, 1.12, z);
      for (const z of [1.85, 2.18]) {
        const tooth = mesh(new THREE.ConeGeometry(.13, .32, 6), white, chassis, x * .64, .64, z);
        tooth.rotation.z = Math.PI;
      }
    }
  } else if (model.style === 'hover') {
    const hoverGlow = new THREE.MeshBasicMaterial({ color: model.trim, transparent: true, opacity: .75 });
    const halo = mesh(new THREE.TorusGeometry(1.78, .13, 8, 38), hoverGlow, chassis, 0, .76, 0);
    halo.rotation.x = Math.PI / 2;
    halo.scale.y = 1.35;
    for (const x of [-1.56, 1.56]) {
      for (const z of [-1.28, 1.28]) {
        const pod = mesh(new THREE.CylinderGeometry(.55, .48, .23, 16), dark, chassis, x, .73, z);
        const rotor = mesh(new THREE.TorusGeometry(.43, .10, 7, 20), hoverGlow, chassis, x, .88, z);
        rotor.rotation.x = Math.PI / 2;
        pod.rotation.y = x * z * .05;
      }
    }
    box(chassis, 2.77, .12, .60, trim, 0, 1.08, -1.75);
    const antenna = box(chassis, .09, .75, .09, trim, 0, 2.19, -1.59);
    antenna.rotation.z = .16;
    mesh(new THREE.SphereGeometry(.22, 10, 8), hoverGlow, chassis, .12, 2.61, -1.59);
  } else {
    for (const x of [-.71, .71]) {
      box(chassis, .18, .09, 1.8, white, x, 1.45, .87);
      const aero = box(chassis, .42, .20, .78, trim, x * 1.5, 1.41, -1.73);
      aero.rotation.y = x * .12;
    }
    box(chassis, 3.13, .13, .48, trim, 0, 1.72, -2.06);
  }
  const wheels = [];
  for (const x of [-1.62, 1.62]) {
    for (const z of [-1.35, 1.42]) {
      const mount = new THREE.Group();
      mount.position.set(model.style === 'grip' ? x * 1.12 : x, model.style === 'grip' ? .74 : .61, z);
      mount.visible = model.style !== 'hover';
      chassis.add(mount);
      const rolling = new THREE.Group();
      mount.add(rolling);
      const wheelRadius = model.style === 'grip' ? .75 : model.style === 'flash' ? .50 : .58;
      const wheelWidth = model.style === 'grip' ? .69 : .47;
      const tire = mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, lite ? 10 : 24), rubber, rolling);
      tire.rotation.z = Math.PI / 2;
      const hub = mesh(new THREE.CylinderGeometry(wheelRadius * .56, wheelRadius * .56, wheelWidth + .02, lite ? 10 : 20), rim, rolling,
        Math.sign(x) * .02);
      hub.rotation.z = Math.PI / 2;
      if (!lite) {
        const center = mesh(new THREE.CylinderGeometry(.15, .15, .51, 16), body, rolling,
          Math.sign(x) * .04);
        center.rotation.z = Math.PI / 2;
        const wheelRing = mesh(new THREE.TorusGeometry(.29, .045, 6, 18), highlight, rolling,
          Math.sign(x) * .29);
        wheelRing.rotation.y = Math.PI / 2;
      }
      wheels.push({ mount, rolling, front: z > 0, radius: wheelRadius });
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
  const helmetBand = mesh(new THREE.SphereGeometry(1, 16, 12), accent, head, 0, 2.91, -.66);
  helmetBand.scale.set(.73, .075, .73);
  const helmetTail = mesh(new THREE.SphereGeometry(1, 12, 8), highlight, head, 0, 2.59, -1.45);
  helmetTail.scale.set(.22, .26, .05);
  const face = mesh(new THREE.SphereGeometry(.65, lite ? 12 : 24, lite ? 8 : 16), skin, head, 0, 2.43, -.18);
  face.scale.set(1.0, .74, .40);
  const visor = mesh(new THREE.SphereGeometry(1, 16, 10), dark, head, 0, 2.77, .04);
  visor.scale.set(.68, .08, .16);
  for (const x of [-.25, .25]) {
    const e = mesh(new THREE.SphereGeometry(.12, 12, 10), eye, head, x, 2.54, .075);
    e.scale.set(.83, 1.5, .52);
    if (!lite) {
      mesh(new THREE.SphereGeometry(.035, 8, 6), white, head, x - .03, 2.59, .14);
      const cheek = mesh(new THREE.SphereGeometry(.10, 10, 8), makeMaterial(0xf69caa, .7), head, x * 1.9, 2.3, .06);
      cheek.scale.set(1.15, .52, .42);
    }
  }
  const smile = mesh(new THREE.TorusGeometry(.12, .025, 6, 16, Math.PI), eye, head, 0, 2.22, .072);
  smile.rotation.z = Math.PI;
  if (['bear', 'ears', 'fox', 'rabbit', 'dino'].includes(character.style)) {
    for (const x of [-.55, .55]) {
      const ear = mesh(['fox', 'dino'].includes(character.style) ? new THREE.ConeGeometry(.27, .60, 12) :
        new THREE.SphereGeometry(.27, 12, 10), helmet, head, x, 3.18, -.68);
      if (character.style === 'rabbit') ear.scale.y = 2.0;
      else if (character.style !== 'fox') ear.scale.y = .9;
    }
  } else if (character.style === 'buns') {
    for (const x of [-.72, .72]) mesh(new THREE.SphereGeometry(.32, 14, 12), helmet, head, x, 2.94, -.8);
  } else if (character.style === 'cap') {
    const brim = mesh(new THREE.SphereGeometry(1, 12, 8), accent, head, 0, 2.93, -.12);
    brim.scale.set(.72, .09, .43);
  } else if (character.style === 'robot') {
    const antenna = box(head, .08, .36, .08, accent, 0, 3.27, -.68);
    antenna.rotation.z = .2;
    mesh(new THREE.SphereGeometry(.14, 10, 8), highlight, head, 0, 3.52, -.68);
    for (const x of [-.38, .38]) box(head, .15, .32, .16, accent, x, 2.54, -.6);
  } else if (character.style === 'sun') {
    for (const x of [-.38, 0, .38]) {
      const ray = mesh(new THREE.ConeGeometry(.12, .46, 8), highlight, head, x, 3.25, -.68);
      ray.rotation.z = x * -.35;
    }
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
  // The rear gadget dock stays visible; its loaded weapon changes with inventory.
  box(chassis, 1.25, .16, .82, dark, 0, 1.65, -2.25);
  box(chassis, 1.02, .12, .70, trim, 0, 1.76, -2.25);
  for (const x of [-1.30, 1.30]) {
    const launcher = mesh(new THREE.CylinderGeometry(.14, .19, .78, 9), trim, chassis, x, 1.37, 1.18);
    launcher.rotation.x = Math.PI / 2;
    mesh(new THREE.TorusGeometry(.16, .045, 6, 12), dark, chassis, x, 1.37, 1.60);
  }
  const weaponMeshes = {};
  const bananaModel = new THREE.Group();
  bananaModel.position.set(0, 2.19, -2.25);
  chassis.add(bananaModel);
  const bananaArc = mesh(new THREE.TorusGeometry(.43, .14, 7, 17, Math.PI * 1.3),
    makeMaterial(0xffe446, .35), bananaModel);
  bananaArc.rotation.z = .42;
  mesh(new THREE.SphereGeometry(.13, 8, 6), makeMaterial(0x795b2c), bananaModel, -.42, -.15, 0);
  weaponMeshes.banana = bananaModel;
  const ballModel = new THREE.Group();
  ballModel.position.set(0, 2.25, -2.25);
  chassis.add(ballModel);
  mesh(new THREE.SphereGeometry(.48, 12, 10), makeMaterial(0xff5368, .26), ballModel);
  const ballBand = mesh(new THREE.TorusGeometry(.48, .08, 7, 17), white, ballModel);
  ballBand.rotation.y = .45;
  weaponMeshes.ball = ballModel;
  const pieModel = new THREE.Group();
  pieModel.position.set(0, 2.17, -2.25);
  chassis.add(pieModel);
  mesh(new THREE.CylinderGeometry(.52, .38, .19, 14), makeMaterial(0xffc06f), pieModel);
  mesh(new THREE.SphereGeometry(.43, 12, 8), white, pieModel, 0, .14, 0).scale.y = .43;
  mesh(new THREE.SphereGeometry(.12, 8, 6), makeMaterial(0xef4f6b), pieModel, 0, .37, 0);
  weaponMeshes.pie = pieModel;
  Object.values(weaponMeshes).forEach(object => { object.visible = false; });
  if (!lite) {
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff3b9 });
    for (const x of [-1.12, 1.12]) {
      mesh(new THREE.SphereGeometry(.19, 12, 8), lamp, chassis, x, .92, 2.13);
      mesh(new THREE.SphereGeometry(.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff506d }), chassis, x, .82, -2.20);
    }
    box(chassis, .96, .11, .08, highlight, 0, 1.09, -2.16);
    for (const x of [-.82, .82]) {
      const exhaust = mesh(new THREE.CylinderGeometry(.22, .26, .36, 12), rim, chassis, x, .68, -2.29);
      exhaust.rotation.x = Math.PI / 2;
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
  const shieldBubble = mesh(new THREE.SphereGeometry(2.55, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x56e4ff, transparent: true, opacity: .20,
      depthWrite: false, side: THREE.DoubleSide }), chassis, 0, 1.8, 0);
  shieldBubble.visible = false;
  const pulseRing = mesh(new THREE.TorusGeometry(2.1, .12, 6, 28),
    new THREE.MeshBasicMaterial({ color: 0xffe34d, transparent: true, opacity: .75,
      depthWrite: false }), chassis, 0, .65, 0);
  pulseRing.rotation.x = Math.PI / 2;
  pulseRing.visible = false;
  group.userData = { chassis, driver, head, arms, wheels, flames, shieldBubble, pulseRing, weaponMeshes,
    modelStyle: model.style,
    waveTime: 0, lastDistance: 0, animationTime: 0 };
  scene.add(group);
  return group;
}

function setup3D() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(any-pointer: coarse)').matches ? 1.3 : 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, .15, 640);
  previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  previewScene = new THREE.Scene();
  previewScene.add(new THREE.HemisphereLight(0xffffff, 0x7c9db7, 1.8));
  const previewLight = new THREE.DirectionalLight(0xffffff, 1.8);
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
  scene.add(new THREE.HemisphereLight(0xe5faff, 0x6c9b61, 1.6));
  const sunlight = new THREE.DirectionalLight(0xffefc8, 1.8);
  sunlight.position.set(-90, 150, -40);
  scene.add(sunlight);
  createCurve();
  createRoad();
  createScenery();
  if (selectedMode === 'item') createItemPickups();
  playerKart = createKart(appearance.paint, selectedCharacter, false, { ...appearance, model: selectedKart.id });
  previewKart = playerKart.clone(true);
  previewKart.position.set(0, 0, 0);
  previewKart.rotation.y = -.3;
  previewScene.add(previewKart);
  opponents = AI_COLORS.map((color, i) => {
    const character = CHARACTERS[(i + 1) % CHARACTERS.length];
    return createKart(color, character, true, { helmet: character.helmet, rim: 0xe3edf6,
      decal: 'stripe', model: KARTS[(i + 1) % KARTS.length].id });
  });
  opponents.forEach(kart => { kart.visible = false; });
  remoteKarts.clear();
  smoke = [];
  bananaTraps = [];
  projectiles = [];
  game = freshGame();
}

function syncKart(kart, distance, lateral, lean = 0, boost = false, heading = 0, speed = 0, dt = 0, shield = false, weapon = null) {
  const at = pose(distance);
  kart.position.copy(at.point).addScaledVector(at.right, lateral);
  const parts = kart.userData;
  parts.animationTime += dt;
  const motion = Math.min(1, speed / MAX_SPEED);
  kart.position.y += .16 + (parts.modelStyle === 'hover' ? .48 + Math.sin(parts.animationTime * 3.8) * .07 : 0) +
    Math.sin(parts.animationTime * (10 + speed * .24)) * .025 * motion;
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
    wheel.rolling.rotation.x += speed * dt / wheel.radius;
    if (wheel.front) wheel.mount.rotation.y = lerp(wheel.mount.rotation.y, -lean * .42, Math.min(1, dt * 12));
  }
  for (const flame of kart.userData.flames) {
    flame.visible = boost;
    if (boost) flame.scale.y = .7 + Math.random() * .7;
  }
  parts.shieldBubble.visible = shield;
  for (const [kind, object] of Object.entries(parts.weaponMeshes)) object.visible = weapon === kind;
  parts.waveTime = Math.max(0, parts.waveTime - dt);
  parts.pulseRing.visible = parts.waveTime > 0;
  if (parts.waveTime > 0) {
    const progress = 1 - parts.waveTime;
    parts.pulseRing.scale.setScalar(1 + progress * 4);
    parts.pulseRing.material.opacity = parts.waveTime * .75;
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
      kart = createKart(color, character, true, { helmet, rim, decal: player.decal || 'bolt', model: player.model });
      kart.userData.distance = player.distance;
      kart.userData.lateral = player.lateral;
      remoteKarts.set(player.id, kart);
    }
    kart.userData.distance = Math.abs(player.distance - kart.userData.distance) > 70 ?
      player.distance : lerp(kart.userData.distance, player.distance, Math.min(1, dt * 9));
    kart.userData.lateral = lerp(kart.userData.lateral, player.lateral, Math.min(1, dt * 9));
    syncKart(kart, kart.userData.distance, kart.userData.lateral, 0, player.boost, 0, player.speed || 0, dt, player.shield, player.held);
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
  $('#kartChoices').innerHTML = KARTS.map(kart =>
    `<button type="button" class="kart-choice ${kart.id === selectedKart.id ? 'active' : ''}" data-kart="${kart.id}" aria-pressed="${kart.id === selectedKart.id}"><span>${kart.icon}</span><strong>${kart.name}</strong><small>${kart.skill}</small></button>`).join('');
  $('#kartCaption').textContent = `${selectedKart.name} · ${selectedKart.skill}`;
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
  ui.menu.classList.toggle('student-invite', enabled && Boolean(studentInviteCode));
  $('#soloTab').classList.toggle('active', !enabled);
  $('#onlineTab').classList.toggle('active', enabled);
  $('#soloActions').hidden = enabled;
  $('#onlineActions').hidden = !enabled;
  $('#studentJoinBanner').hidden = !enabled || !studentInviteCode;
  if (enabled) ui.networkStatus.textContent = 'สร้างห้องหรือใส่รหัสห้องเพื่อแข่งกับเพื่อน สูงสุด 50 คน';
}

function setNetworkStatus(message, error = false) {
  ui.networkStatus.textContent = message;
  ui.networkStatus.classList.toggle('error', error);
}

function roomInviteUrl(code) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('room', code);
  return url.href;
}

function drawRoomQr(canvas, url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const ctx = canvas.getContext('2d');
  const count = qr.getModuleCount();
  const cell = Math.floor(canvas.width / (count + 8));
  const offset = Math.floor((canvas.width - cell * count) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#101721';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) ctx.fillRect(offset + col * cell, offset + row * cell, cell, cell);
    }
  }
}

function showRoomQr(code) {
  const url = roomInviteUrl(code);
  const link = $('#inviteUrl');
  link.href = url;
  link.textContent = url;
  $('#qrFullscreenCode').textContent = code;
  if (renderedRoomQr === code) return;
  drawRoomQr($('#roomQr'), url);
  drawRoomQr($('#roomQrLarge'), url);
  renderedRoomQr = code;
}

function qrRoomCode(raw) {
  const value = String(raw || '').trim();
  if (/^[A-Z2-9]{5}$/i.test(value)) return value.toUpperCase();
  try {
    const url = new URL(value);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return null;
    const code = url.searchParams.get('room')?.toUpperCase();
    return /^[A-Z2-9]{5}$/.test(code || '') ? code : null;
  } catch { return null; }
}

function prepareQrJoin(code) {
  studentInviteCode = code;
  setOnlineSelection(true);
  $('#roomCode').value = code;
  $('#studentRoomCode').textContent = code;
  $('#studentJoinBanner').hidden = false;
  $('#inviteNotice').hidden = true;
  prepareStudentName();
  ui.menu.hidden = false;
  ui.menu.querySelector('.menu-card').scrollTo({ top: 0, behavior: 'smooth' });
}

function stopQrScanner() {
  scannerActive = false;
  clearTimeout(scannerTimer);
  scannerTimer = null;
  scannerStream?.getTracks().forEach(track => track.stop());
  scannerStream = null;
  $('#scannerVideo').srcObject = null;
  $('#scannerVideo').hidden = true;
  $('#qrScanner').hidden = true;
}

async function scanQrFrame() {
  if (!scannerActive) return;
  try {
    const video = $('#scannerVideo');
    if (video.readyState >= 2) {
      const results = await scannerDetector.detect(video);
      if (!scannerActive) return;
      for (const result of results) {
        const code = qrRoomCode(result.rawValue);
        if (!code) { $('#scannerStatus').textContent = 'QR นี้ไม่ใช่ห้อง Turbo Trail'; continue; }
        stopQrScanner();
        prepareQrJoin(code);
        return;
      }
    }
  } catch { $('#scannerStatus').textContent = 'อ่าน QR ไม่สำเร็จ ลองขยับกล้องให้เห็นภาพชัดขึ้น'; }
  if (scannerActive) scannerTimer = setTimeout(scanQrFrame, 220);
}

async function openQrScanner() {
  $('#qrScanner').hidden = false;
  $('#scannerVideo').hidden = true;
  $('#scannerStatus').textContent = 'กำลังเปิดกล้อง…';
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    $('#scannerStatus').textContent = 'เบราว์เซอร์นี้สแกนในเกมไม่ได้ ใช้แอปกล้องมือถือสแกน QR ของครู หรือกรอกรหัสห้อง';
    return;
  }
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    if (!formats.includes('qr_code')) throw new Error('ไม่รองรับ QR');
    if ($('#qrScanner').hidden) return;
    scannerDetector = new BarcodeDetector({ formats: ['qr_code'] });
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if ($('#qrScanner').hidden) { stopQrScanner(); return; }
    const video = $('#scannerVideo');
    video.srcObject = scannerStream;
    video.hidden = false;
    await video.play();
    scannerActive = true;
    $('#scannerStatus').textContent = 'เล็งกล้องไปที่ QR บนหน้าจอของครู';
    scanQrFrame();
  } catch {
    stopQrScanner();
    $('#qrScanner').hidden = false;
    $('#scannerStatus').textContent = 'เปิดกล้องไม่ได้ ใช้แอปกล้องมือถือสแกน QR ของครู หรือกรอกรหัสห้อง';
  }
}

function prepareStudentName() {
  const field = $('#playerName');
  if (field.value.trim() && field.value.trim() !== 'Rider') return;
  const suffix = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 6) :
    Math.random().toString(36).slice(2, 8);
  field.value = `นักเรียน-${suffix.toUpperCase()}`;
}

function renderLobby(data) {
  if (!data || !network.room || data.code !== network.room) return;
  connectedPlayers = data.players || [];
  ui.lobbyCode.textContent = data.code;
  ui.lobbyCount.textContent = String(connectedPlayers.length);
  ui.lobbyDetails.textContent = `${TRACKS.find(track => track.id === data.track)?.name || 'สนาม'} · ${data.mode === 'item' ? 'ไอเท็มเรซ' : 'สปีดเรซ'}${data.learning ? ` · โหมดเรียนรู้ ${data.questions?.length || 0} ข้อ` : ''}`;
  showRoomQr(data.code);
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
  if (data.type === 'item' && game.mode === 'racing') handleWeaponEvent(data);
  if (data.type === 'error') setNetworkStatus(data.message, true);
}

function onNetworkClose() {
  ui.roomBadge.hidden = true;
  $('#qrFullscreen').hidden = true;
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
      code, name: $('#playerName').value, character: selectedCharacter.id, model: selectedKart.id,
      kart: `#${appearance.paint.toString(16).padStart(6, '0')}`,
      helmet: `#${appearance.helmet.toString(16).padStart(6, '0')}`,
      rim: `#${appearance.rim.toString(16).padStart(6, '0')}`,
      decal: appearance.decal,
      track: selectedTrack.id, mode: selectedMode,
      learning: learningEnabled, questions: learningEnabled ? questionBank : [],
    });
    renderLobby(data);
    studentInviteCode = null;
    $('#studentJoinBanner').hidden = true;
    ui.menu.classList.remove('student-invite');
    $('#inviteNotice').hidden = true;
    try { sessionStorage.setItem('turbo-trail-player-name', $('#playerName').value.trim()); } catch { /* Storage is optional. */ }
    setNetworkStatus(`เชื่อมต่อห้อง ${data.code} แล้ว`);
  } catch (error) {
    setNetworkStatus(error.message, true);
    if (!$('#inviteNotice').hidden) $('#inviteNotice').textContent = `เข้าห้องไม่ได้: ${error.message}`;
  }
  finally { $('#createRoomButton').disabled = $('#joinRoomButton').disabled = false; }
}

function resetRace(online = false, startAt = 0) {
  audio.start();
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
  $('#qrFullscreen').hidden = true;
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
  hitTime = 0; hitKind = null;
  for (const effect of [...bananaTraps, ...projectiles]) scene.remove(effect.mesh);
  bananaTraps = []; projectiles = [];
  earnedPower = null; activeQuiz = null; nextQuizDistance = FIRST_QUIZ_DISTANCE;
  quizCursor = 0; quizCorrect = 0; quizAttempted = 0;
  $('#quizPanel').hidden = true;
  $('#quizBackdrop').hidden = true;
  document.body.classList.remove('quiz-active');
  ui.leaderboard.hidden = true;
  $('#leaderboardButton').setAttribute('aria-expanded', 'false');
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
  audio.cue('finish');
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
  stopQrScanner();
  network.close();
  setNetworkStatus('สร้างห้องหรือใส่รหัสห้องเพื่อแข่งกับเพื่อน สูงสุด 50 คน');
  onlineRace = false;
  connectedPlayers = [];
  ui.lobby.hidden = true;
  $('#qrFullscreen').hidden = true;
  renderedRoomQr = '';
  ui.pauseMenu.hidden = true;
  ui.results.hidden = true;
  $('#quizPanel').hidden = true;
  $('#quizBackdrop').hidden = true;
  document.body.classList.remove('quiz-active');
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
  const reward = QUIZ_REWARDS[quizCorrect % QUIZ_REWARDS.length];
  activeQuiz = { index, deadline: performance.now() + 20000 };
  game.mode = 'quiz';
  game.speed = 0;
  Object.keys(keys).forEach(key => { keys[key] = false; });
  resetTouchSteering();
  if (onlineRace) network.send({ type: 'state', distance: game.distance, lateral: game.lateral,
    speed: 0, boost: false, shield: shieldTime > 0, held: earnedPower || heldItem });
  $('#quizQuestion').textContent = question.question;
  $('#quizReward').textContent = `ตอบถูกได้ ${POWERS[reward].icon} ${POWERS[reward].name}`;
  $('#quizOptions').replaceChildren(...question.options.map((option, choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${'กขคง'[choice]}. ${option}`;
    button.addEventListener('click', () => answerQuiz(choice));
    return button;
  }));
  $('#quizTimer').textContent = onlineRace ? '20 วินาที' : 'หยุดเวลาแข่งชั่วคราว';
  $('#quizPanel').hidden = false;
  $('#quizBackdrop').hidden = false;
  document.body.classList.add('quiz-active');
  $('#quizOptions button')?.focus();
}

function answerQuiz(choice) {
  if (!activeQuiz) return;
  const question = raceQuestions[activeQuiz.index];
  if (choice !== null) {
    quizAttempted++;
    if (choice === question.answer) {
      audio.cue('correct');
      earnedPower = QUIZ_REWARDS[quizCorrect % QUIZ_REWARDS.length];
      quizCorrect++;
      toast(`ถูกต้อง! ได้ ${POWERS[earnedPower].icon} ${POWERS[earnedPower].name} · กดใช้พลัง`, 2.4);
    } else { audio.cue('wrong'); toast(`ยังไม่ถูก · คำตอบคือ ${question.options[question.answer]}`, 2.4); }
  } else { audio.cue('wrong'); toast('ข้ามคำถามแล้ว', 1.2); }
  quizCursor++;
  nextQuizDistance = Math.max(nextQuizDistance + QUIZ_INTERVAL, game.distance + QUIZ_INTERVAL);
  activeQuiz = null;
  $('#quizPanel').hidden = true;
  $('#quizBackdrop').hidden = true;
  document.body.classList.remove('quiz-active');
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
  ui.position.innerHTML = String(rank()) + `<span>/ ${onlineRace ? Math.max(1, connectedPlayers.length) : game.ai.length + 1}</span>`;
  ui.lap.innerHTML = String(Math.max(1, Math.min(RACE_LAPS, Math.floor(game.distance / trackLength) + 1))) +
    `<span>/ ${RACE_LAPS}</span>`;
  ui.time.textContent = formatTime(game.raceTime);
  ui.speed.textContent = String(Math.round(game.speed * 3.6));
  ui.charge.textContent = String(Math.floor(game.driftCharge)) + '%';
  ui.chargeFill.style.width = String(game.driftCharge) + '%';
  $('#quizScore').textContent = `${quizCorrect}/${quizAttempted}`;
  const ready = game.driftCharge >= 55 || Boolean(earnedPower || heldItem);
  const power = earnedPower || heldItem;
  ui.boostHint.textContent = power ? `${earnedPower ? 'พลังจากคำตอบ' : 'ไอเท็ม'}: ${POWERS[power].name} · กด BOOST` :
    game.boostTime > 0 ? 'TURBO ACTIVE!' :
    ready ? 'บูสต์พร้อมแล้ว!' : 'ดริฟต์เพื่อชาร์จบูสต์';
  $('.boost-button').classList.toggle('ready', ready);
  const shownPower = power || (shieldTime > 0 ? 'shield' : null);
  $('#powerCard').hidden = !shownPower;
  if (shownPower) {
    $('#powerIcon').textContent = POWERS[shownPower].icon;
    $('#powerName').textContent = POWERS[shownPower].name;
    $('#powerDescription').textContent = power ? POWERS[shownPower].detail : `ทำงานอยู่ ${Math.ceil(shieldTime)} วินาที`;
    $('#powerUseButton').hidden = !power;
  }
}

function weaponMesh(kind) {
  const group = new THREE.Group();
  const yellow = makeMaterial(0xffe039, .42);
  const pink = makeMaterial(0xff5c7d, .32);
  const white = makeMaterial(0xffffff, .38);
  if (kind === 'banana') {
    for (let i = 0; i < 4; i++) {
      const peel = mesh(new THREE.ConeGeometry(.32, 1.45, 7), yellow, group);
      peel.position.set(Math.sin(i * Math.PI / 2) * .37, .19, Math.cos(i * Math.PI / 2) * .37);
      peel.rotation.z = Math.cos(i * Math.PI / 2) * .92;
      peel.rotation.x = -Math.sin(i * Math.PI / 2) * .92;
    }
    mesh(new THREE.SphereGeometry(.32, 10, 8), yellow, group, 0, .21, 0);
  } else if (kind === 'ball') {
    mesh(new THREE.SphereGeometry(.84, 18, 12), pink, group);
    for (const angle of [0, Math.PI / 2]) {
      const stripe = mesh(new THREE.TorusGeometry(.85, .10, 8, 28), white, group);
      stripe.rotation.y = angle;
    }
  } else {
    mesh(new THREE.CylinderGeometry(.83, .72, .30, 18), makeMaterial(0xd99449), group);
    mesh(new THREE.SphereGeometry(.75, 16, 10), white, group, 0, .21, 0).scale.y = .42;
    mesh(new THREE.SphereGeometry(.17, 10, 8), pink, group, 0, .53, 0);
  }
  scene.add(group);
  return group;
}

function weaponPosition(distance, lateral, height = 0) {
  const at = pose(distance);
  return at.point.clone().addScaledVector(at.right, lateral).add(new THREE.Vector3(0, height, 0));
}

function removeWeapon(effect) {
  scene.remove(effect.mesh);
  effect.mesh.traverse(object => {
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material?.dispose();
  });
}

function weaponHit(kind) {
  if (shieldTime > 0) {
    toast('เกราะป้องกันรับการโจมตี! 🛡️');
    audio.cue('blocked');
    return;
  }
  hitKind = kind;
  hitTime = kind === 'pie' ? 2.0 : kind === 'banana' ? 1.7 : 1.3;
  game.speed *= kind === 'banana' ? .35 : .55;
  toast(kind === 'banana' ? 'ลื่นเปลือกกล้วย! 🍌' : kind === 'pie' ? 'โดนพายครีม! 🥧' : 'โดนลูกบอลเด้ง! 🏐', 1.8);
  audio.cue('hit');
}

function handleWeaponEvent(event) {
  if (event.item === 'pulse') {
    const attackerKart = remoteKarts.get(event.id);
    if (attackerKart) attackerKart.userData.waveTime = 1;
    const attacker = connectedPlayers.find(player => player.id === event.id);
    if (event.id !== network.id && attacker && attacker.distance < game.distance &&
        game.distance - attacker.distance < 120) weaponHit('pulse');
  } else if (event.item === 'banana' && Number.isFinite(event.distance) && Number.isFinite(event.lateral)) {
    const placed = { ownerId: event.id, distance: event.distance, lateral: event.lateral,
      age: 0, mesh: weaponMesh('banana') };
    placed.mesh.position.copy(weaponPosition(placed.distance, placed.lateral, .43));
    bananaTraps.push(placed);
  } else if ((event.item === 'ball' || event.item === 'pie') && Number.isFinite(event.fromDistance)) {
    const shot = { kind: event.item, targetId: event.targetId, fromDistance: event.fromDistance,
      fromLateral: event.fromLateral, toDistance: event.toDistance, toLateral: event.toLateral,
      age: 0, duration: .85, mesh: weaponMesh(event.item) };
    projectiles.push(shot);
    if (event.id === network.id) toast(event.item === 'ball' ? 'ยิงลูกบอลเด้ง! 🏐' : 'ปาพายครีม! 🥧');
  }
}

function updateWeapons(dt) {
  for (let i = bananaTraps.length - 1; i >= 0; i--) {
    const trap = bananaTraps[i];
    trap.age += dt;
    trap.mesh.rotation.y += dt * .8;
    if (game.mode === 'racing' && trap.ownerId !== (onlineRace ? network.id : 'me') &&
        Math.abs(game.distance - trap.distance) < 2.5 && Math.abs(game.lateral - trap.lateral) < 2.1) {
      weaponHit('banana');
      removeWeapon(trap); bananaTraps.splice(i, 1);
    } else if (!onlineRace && game.ai.some(ai => Math.abs(ai.distance - trap.distance) < 2.5 &&
        Math.abs(ai.lateral - trap.lateral) < 2.1 && (ai.slowTime = 2.5))) {
      removeWeapon(trap); bananaTraps.splice(i, 1);
    } else if (trap.age > 18) {
      removeWeapon(trap); bananaTraps.splice(i, 1);
    }
  }
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const shot = projectiles[i];
    shot.age += dt;
    const t = Math.min(1, shot.age / shot.duration);
    const target = onlineRace ? connectedPlayers.find(player => player.id === shot.targetId) :
      typeof shot.targetId === 'number' ? game.ai[shot.targetId] : null;
    const endDistance = shot.targetId === (onlineRace ? network.id : 'me') ? game.distance : target?.distance ?? shot.toDistance;
    const endLateral = shot.targetId === (onlineRace ? network.id : 'me') ? game.lateral : target?.lateral ?? shot.toLateral;
    shot.mesh.position.copy(weaponPosition(lerp(shot.fromDistance, endDistance, t),
      lerp(shot.fromLateral, endLateral, t), 2 + Math.sin(t * Math.PI) * 5));
    shot.mesh.rotation.x += dt * 10;
    shot.mesh.rotation.z += dt * 6;
    if (t >= 1) {
      if (shot.targetId === (onlineRace ? network.id : 'me') && game.mode === 'racing') weaponHit(shot.kind);
      else if (!onlineRace && target) target.slowTime = shot.kind === 'pie' ? 3.5 : 2.4;
      removeWeapon(shot); projectiles.splice(i, 1);
    }
  }
}

function useBoost() {
  if ((earnedPower || (selectedMode === 'item' && heldItem)) && game.mode === 'racing') {
    const item = earnedPower || heldItem;
    if (earnedPower) earnedPower = null;
    else heldItem = null;
    if (item === 'nitro') { game.boostTime = 3.5 * selectedKart.boost; toast('ไนโตรแรงเต็มพิกัด! 🔥'); }
    else if (item === 'shield') { shieldTime = 7; toast('โล่ป้องกันพร้อม! 🛡️'); }
    else if (item === 'pulse') {
      pulseTime = 0;
      playerKart.userData.waveTime = 1;
      if (!onlineRace) game.ai.forEach(ai => {
        if (ai.distance > game.distance && ai.distance - game.distance < 120) ai.slowTime = 2.5;
      });
      toast('ปล่อยคลื่นพลัง! ⚡');
    } else if (item === 'banana' || item === 'ball' || item === 'pie') {
      if (!onlineRace) {
        const rivals = game.ai.map((ai, index) => ({ ...ai, index }))
          .filter(ai => Math.abs(ai.distance - game.distance) < 180)
          .sort((a, b) => Math.abs(a.distance - game.distance) - Math.abs(b.distance - game.distance));
        handleWeaponEvent(item === 'banana' ?
          { id: 'me', item, distance: game.distance - 6, lateral: game.lateral } :
          { id: 'me', item, targetId: rivals[0]?.index ?? null,
            fromDistance: game.distance, fromLateral: game.lateral,
            toDistance: rivals[0]?.distance ?? game.distance + 65,
            toLateral: rivals[0]?.lateral ?? game.lateral });
      }
      if (item === 'banana') toast('วางเปลือกกล้วยไว้ด้านหลัง! 🍌');
    }
    if (onlineRace && (selectedMode === 'item' || learningEnabled)) network.send({ type: 'item', item });
    audio.cue(['shield', 'pulse', 'banana', 'ball', 'pie'].includes(item) ? item : 'boost');
    updateHud();
    return;
  }
  if (game.mode !== 'racing' || game.boostTime > 0 || game.driftCharge < 55) return;
  game.driftCharge -= 55;
  game.boostTime = 2.4 * selectedKart.boost;
  audio.cue('boost');
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
      audio.cue(label === 'GO!' ? 'go' : 'tick');
    }
    if (game.countdown <= -.55) {
      game.mode = 'racing';
      ui.countdown.hidden = true;
      if (!keys.gas) toast(touchLayout() ? 'กด GO ค้างเพื่อออกตัว' : 'กด ↑ หรือ W ค้างเพื่อออกตัว', 2.4);
    }
  } else if (game.mode === 'quiz') {
    if (onlineRace) game.raceTime += dt;
  } else if (game.mode === 'racing') {
    game.raceTime += dt;
    shieldTime = Math.max(0, shieldTime - dt);
    pulseTime = Math.max(0, pulseTime - dt);
    hitTime = Math.max(0, hitTime - dt);
    const accelerating = keys.gas;
    const steer = clamp(Number(keys.right) - Number(keys.left) + touchSteer, -1, 1);
    const drifting = keys.drift && Math.abs(steer) > 0 && game.speed > 13;
    const cap = MAX_SPEED * selectedKart.topSpeed * (game.boostTime > 0 ? 1.3 : 1);
    game.speed += ((accelerating ? 27 * selectedKart.acceleration : -24) -
      game.speed * (game.boostTime > 0 ? .03 : .08)) * dt;
    if (pulseTime > 0) game.speed -= 26 * dt;
    if (hitTime > 0) game.speed -= (hitKind === 'pie' ? 35 : 46) * dt;
    if (game.boostTime > 0) {
      game.boostTime = Math.max(0, game.boostTime - dt);
      game.speed += 27 * dt;
    }
    game.speed = clamp(game.speed, 0, cap);
    const oldDistance = game.distance;
    game.distance += game.speed * Math.cos(game.heading) * dt;
    const before = pose(oldDistance).tangent;
    const after = pose(game.distance).tangent;
    const curveTurn = Math.atan2(before.x * after.z - before.z * after.x,
      before.x * after.x + before.z * after.z);
    Object.assign(game, steerThroughCurve(game, steer, game.speed, selectedKart.steering,
      curveTurn, dt, drifting));
    if (hitTime > 0) game.heading = clamp(game.heading + Math.sin(game.raceTime * 20) * .035 * dt,
      -.65, .65);
    game.lateral += game.lateralVelocity * dt;
    const settled = settleRoadEdge(game.lateral, game.lateralVelocity, game.speed, steer, dt, ROAD_HALF);
    game.lateral = settled.lateral;
    game.lateralVelocity = settled.lateralVelocity;
    game.speed = settled.speed;
    if (Math.abs(game.lateral) > ROAD_HALF - 4.4 && !game.offRoadNotified) {
      toast('ใกล้ขอบทาง · เลี้ยวกลับเข้าถนน', 1.3);
      game.offRoadNotified = true;
    } else if (Math.abs(game.lateral) < ROAD_HALF - 5.5) game.offRoadNotified = false;
    if (drifting) game.driftCharge = clamp(game.driftCharge +
      dt * 38 * (selectedKart.style === 'flash' ? 1.42 : 1) * (.6 + game.speed / MAX_SPEED), 0, 100);
    for (const opponent of onlineRace ? [] : game.ai) {
      opponent.slowTime = Math.max(0, (opponent.slowTime || 0) - dt);
      opponent.distance += opponent.speed * (opponent.slowTime > 0 ? .62 : 1) * dt *
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
          heldItem = ITEM_REWARDS[marker % ITEM_REWARDS.length];
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
          speed: game.speed, boost: game.boostTime > 0, shield: shieldTime > 0,
          held: earnedPower || heldItem });
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
    game.heading, game.speed, dt, shieldTime > 0, earnedPower || heldItem);
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
  updateWeapons(dt);
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
  audio.update(game.speed, ['racing', 'countdown', 'quiz'].includes(game.mode), game.boostTime > 0);
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
  if (game.mode === 'racing' || game.mode === 'countdown') audio.start();
  if (event.key === 'Escape' && !$('#qrFullscreen').hidden) {
    $('#qrFullscreen').hidden = true;
    event.preventDefault(); return;
  }
  if (event.key === 'Escape' && !$('#qrScanner').hidden) {
    stopQrScanner();
    event.preventDefault(); return;
  }
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
  if (document.hidden && !$('#qrScanner').hidden) stopQrScanner();
  if (document.hidden && game.mode === 'racing' && !onlineRace) pauseRace();
});
document.querySelectorAll('[data-control]').forEach((button) => {
  const control = button.dataset.control;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    audio.start();
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
$('#kartChoices').addEventListener('click', event => {
  const button = event.target.closest('[data-kart]');
  if (!button || game.mode !== 'menu') return;
  selectedKart = KARTS.find(kart => kart.id === button.dataset.kart) || KARTS[0];
  try { localStorage.setItem('turbo-trail-garage', JSON.stringify({ ...appearance, model: selectedKart.id })); } catch {}
  buildWorld(); renderChoices();
  const choices = $('#kartChoices'), active = choices.querySelector('.active');
  const row = choices.getBoundingClientRect(), card = active.getBoundingClientRect();
  choices.scrollLeft += card.left - row.left - (row.width - card.width) / 2;
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
$('#powerUseButton').addEventListener('click', useBoost);
function updateSoundButton() {
  const button = $('#soundButton');
  button.textContent = audio.enabled ? '🔊' : '🔇';
  button.setAttribute('aria-label', audio.enabled ? 'ปิดเสียง' : 'เปิดเสียง');
  button.setAttribute('aria-pressed', String(audio.enabled));
}
$('#soundButton').addEventListener('click', () => { audio.toggle(); updateSoundButton(); });
$('#leaderboardButton').addEventListener('click', () => {
  ui.leaderboard.hidden = !ui.leaderboard.hidden;
  $('#leaderboardButton').setAttribute('aria-expanded', String(!ui.leaderboard.hidden));
});
$('#garage').addEventListener('click', event => {
  const swatch = event.target.closest('[data-part][data-color]');
  const decal = event.target.closest('[data-decal]');
  if (swatch) appearance[swatch.dataset.part] = Number(swatch.dataset.color);
  else if (decal) appearance.decal = decal.dataset.decal;
  else return;
  try { localStorage.setItem('turbo-trail-garage', JSON.stringify({ ...appearance, model: selectedKart.id })); } catch { /* Storage is optional. */ }
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
$('#scanQrButton').addEventListener('click', openQrScanner);
$('#closeQrScanner').addEventListener('click', stopQrScanner);
$('#expandQrButton').addEventListener('click', () => { $('#qrFullscreen').hidden = false; });
$('#closeQrFullscreen').addEventListener('click', () => { $('#qrFullscreen').hidden = true; });
$('#copyInviteButton').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomInviteUrl(network.room));
    $('#copyInviteButton').textContent = 'คัดลอกแล้ว ✓';
    setTimeout(() => { $('#copyInviteButton').textContent = 'คัดลอกลิงก์'; }, 1800);
  } catch { $('#copyInviteButton').textContent = 'คัดลอกไม่ได้'; }
});
$('#createRoomButton').addEventListener('click', () => connectRoom('create'));
$('#joinRoomButton').addEventListener('click', () => connectRoom('join'));
$('#studentJoinButton').addEventListener('click', () => connectRoom('join'));
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
  if (game.mode === 'racing' || game.mode === 'countdown' || game.mode === 'paused') {
    ui.touch.hidden = !touchLayout();
  }
});

try {
  try {
    const savedName = sessionStorage.getItem('turbo-trail-player-name');
    if (savedName && savedName !== 'Rider') $('#playerName').value = savedName;
  } catch { /* Storage is optional. */ }
  renderChoices();
  updateSoundButton();
  setup3D();
  frame();
  const sharedCode = new URLSearchParams(location.search).get('room')?.trim().toUpperCase();
  if (/^[A-Z2-9]{5}$/.test(sharedCode || '')) {
    prepareQrJoin(sharedCode);
  }
} catch (error) {
  console.error(error);
  ui.menu.querySelector('p').textContent =
    'เบราว์เซอร์นี้เปิดภาพ 3D ไม่ได้ กรุณาลอง Chrome, Safari, Edge หรือ Firefox เวอร์ชันใหม่';
  $('#startButton').hidden = true;
}
