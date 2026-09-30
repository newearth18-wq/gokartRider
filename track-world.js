import * as THREE from './vendor/three.module.js';
import { createTrackFeatures, FEATURE_INFO, featureLateral, isMovingObstacle } from './track-features.mjs?v=15-0';

// Original toy-like scenery: saturated trim, rounded props and readable road markings.
export function buildTrackDetails(scene, track, pose, length, roadHalf) {
  const features = createTrackFeatures(track.id, length);
  const animated = [];
  const material = (color, roughness = .65) => new THREE.MeshStandardMaterial({ color, roughness });
  const white = material(0xfffbef), navy = material(0x173a70), gold = material(0xffcc37, .3);
  const cyan = material(0x3de0ef, .3), pink = material(0xff6698, .35);
  const add = (parent, geometry, paint, x = 0, y = 0, z = 0) => {
    const object = new THREE.Mesh(geometry, paint);
    object.position.set(x, y, z); parent.add(object); return object;
  };
  const box = (parent, w, h, d, paint, x = 0, y = 0, z = 0) => add(parent,
    new THREE.BoxGeometry(w, h, d), paint, x, y, z);
  const sphere = (parent, radius, paint, x = 0, y = 0, z = 0) => add(parent,
    new THREE.SphereGeometry(radius, 14, 10), paint, x, y, z);
  function groupAt(distance, lateral = 0) {
    const at = pose(distance), group = new THREE.Group();
    group.position.copy(at.point).addScaledVector(at.right, lateral);
    group.rotation.y = Math.atan2(at.tangent.x, at.tangent.z);
    scene.add(group); return group;
  }
  function label(text, color = '#ffffff', background = '#163c79') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d'); context.fillStyle = background;
    context.fillRect(0, 0, 512, 128); context.strokeStyle = color; context.lineWidth = 8;
    context.strokeRect(8, 8, 496, 112); context.fillStyle = color;
    context.font = '900 58px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text, 256, 66, 470);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  }
  function surfaceTexture(kind) {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
    const c = canvas.getContext('2d');
    c.fillStyle = { boost: '#087aa9', ramp: '#df8521', ice: '#83d9f6', sand: '#e7b85f' }[kind];
    c.fillRect(0, 0, 128, 256);
    if (kind === 'boost' || kind === 'ramp') {
      c.fillStyle = kind === 'boost' ? '#baffff' : '#fff0a4';
      for (const y of [12, 92, 172]) {
        c.beginPath(); c.moveTo(16, y + 48); c.lineTo(64, y); c.lineTo(112, y + 48);
        c.lineTo(112, y + 70); c.lineTo(64, y + 22); c.lineTo(16, y + 70); c.fill();
      }
      c.fillStyle = '#ffffff'; c.fillRect(2, 0, 4, 256); c.fillRect(122, 0, 4, 256);
    } else {
      c.strokeStyle = kind === 'ice' ? '#d8faff' : '#cd9a4b'; c.lineWidth = 3;
      for (let i = 0; i < 11; i++) {
        c.beginPath(); c.moveTo((i * 37) % 128, i * 23); c.lineTo((i * 37 + 44) % 128, i * 23 + 16);
        c.lineTo((i * 37 + 73) % 128, i * 23 + 38); c.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  function ribbon(feature, left, right, paint, height = .09, ramp = false) {
    const positions = [], uv = [];
    for (let i = 0; i < 12; i++) {
      for (const [step, lateral, u] of [[i, left, 0], [i, right, 1], [i + 1, right, 1],
                                      [i, left, 0], [i + 1, right, 1], [i + 1, left, 0]]) {
        const t = step / 12;
        const at = pose(feature.distance + (t - .5) * feature.length);
        const point = at.point.clone().addScaledVector(at.right, feature.lateral + lateral);
        positions.push(point.x, point.y + height + (ramp ? t * 1.8 : 0), point.z);
        uv.push(u, t);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals();
    add(scene, geometry, paint);
  }
  function warning(feature) {
    const name = { boost: 'TURBO', ramp: 'JUMP', ice: 'ICE / SLOW', sand: 'SAND',
      bumper: 'DODGE!', boulder: 'ROCK!', snowball: 'SNOWBALL!', cargo: 'CARGO!' }[feature.kind];
    for (const side of [-1, 1]) {
      const sign = groupAt(feature.distance - feature.length / 2 - 38, side * (roadHalf + 5));
      box(sign, .24, 4.5, .24, white, 0, 2.25);
      add(sign, new THREE.PlaneGeometry(5.8, 1.45), label(name, '#fff3a2'), 0, 4.5).rotation.y = Math.PI;
      sphere(sign, .32, gold, 0, 5.6);
    }
  }
  for (const feature of features) {
    warning(feature);
    if (!isMovingObstacle(feature)) {
      const paint = new THREE.MeshStandardMaterial({ map: surfaceTexture(feature.kind),
        roughness: feature.kind === 'ice' ? .18 : .65, metalness: feature.kind === 'ice' ? .22 : .05,
        emissive: feature.kind === 'boost' ? 0x11a7d8 : 0x000000,
        emissiveIntensity: .3, side: THREE.DoubleSide });
      ribbon(feature, -feature.width / 2, feature.width / 2, paint, .095, feature.kind === 'ramp');
      if (feature.kind === 'ramp') {
        const end = groupAt(feature.distance + feature.length / 2, feature.lateral);
        box(end, feature.width, 1.8, .4, navy, 0, .9);
        box(end, feature.width + .2, .18, .55, gold, 0, 1.83);
      }
      if (feature.kind === 'boost' || feature.kind === 'ramp') {
        const trim = new THREE.MeshBasicMaterial({ color: FEATURE_INFO[feature.kind].color,
          transparent: true, opacity: .82, side: THREE.DoubleSide });
        for (const side of [-1, 1]) ribbon(feature, side * feature.width / 2 - .12,
          side * feature.width / 2 + .12, trim, .14, feature.kind === 'ramp');
        animated.push({ kind: 'pad', paint, trim });
      }
      continue;
    }
    const mover = groupAt(feature.distance);
    if (feature.kind === 'cargo') {
      box(mover, 6, 4.6, 6, material(0xff8b4a), 0, 2.3);
      for (const x of [-2.7, 0, 2.7]) box(mover, .18, 4.85, 6.12, white, x, 2.3);
      box(mover, 6.12, .24, 6.12, gold, 0, 4.72);
      add(mover, new THREE.PlaneGeometry(4.5, 1.2), label('CARGO'), 0, 2.4, -3.02).rotation.y = Math.PI;
      box(mover, .09, 5.6, .09, navy, 0, 7.65);
    } else {
      const paint = feature.kind === 'bumper' ? pink : feature.kind === 'boulder' ? material(0xc78955) : white;
      const ball = feature.kind === 'boulder' ? add(mover, new THREE.DodecahedronGeometry(3), paint, 0, 3) :
        sphere(mover, 3, paint, 0, 3);
      if (feature.kind === 'bumper') {
        const ring = add(ball, new THREE.TorusGeometry(3.02, .24, 8, 24), gold);
        ring.rotation.x = Math.PI / 2;
        sphere(ball, .38, white, -1.0, .7, -2.7); sphere(ball, .38, white, 1.0, .7, -2.7);
        sphere(ball, .17, navy, -1.0, .7, -3); sphere(ball, .17, navy, 1.0, .7, -3);
      }
      mover.userData.ball = ball;
    }
    const lane = { ...feature, length: 1.1, lateral: 0 };
    ribbon(lane, -roadHalf + 1, roadHalf - 1,
      new THREE.MeshBasicMaterial({ color: 0xffd84a, side: THREE.DoubleSide }), .08);
    if (feature.kind === 'cargo') {
      const crane = groupAt(feature.distance);
      for (const side of [-1, 1]) {
        box(crane, 1.4, 11.3, 1.4, gold, side * (roadHalf + 6), 5.6);
        box(crane, 3.2, 1, 3.2, navy, side * (roadHalf + 6), .5);
      }
      box(crane, (roadHalf + 6) * 2, 1.15, 1.8, gold, 0, 11.3);
      box(crane, (roadHalf + 6) * 2, .2, 2, white, 0, 11.95);
    }
    animated.push({ kind: 'obstacle', feature, mover });
  }

  // Find scenery sites clear of every part of the circuit, including nearby bends.
  const roadSamples = Array.from({ length: 320 }, (_, i) => pose(length * i / 320).point);
  function roadside(distance, side, offset, radius) {
    const at = pose(distance);
    for (let away = offset; away < 450; away += 10) {
      const point = at.point.clone().addScaledVector(at.right, side * away);
      const clear = roadSamples.every((a, i) => {
        const b = roadSamples[(i + 1) % roadSamples.length], dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        return (point.x - a.x - dx * t) ** 2 + (point.z - a.z - dz * t) ** 2 > (roadHalf + radius + 4) ** 2;
      });
      if (!clear) continue;
      const group = new THREE.Group(); group.position.copy(point);
      group.rotation.y = Math.atan2(at.tangent.x, at.tangent.z); scene.add(group); return group;
    }
    return null;
  }
  // Start-area grandstands and themed advertising make the first view recognizable.
  for (const side of [-1, 1]) {
    const stand = roadside(50, side, roadHalf + 13, 11);
    if (!stand) continue;
    for (let row = 0; row < 4; row++) {
      box(stand, 7, .55 + row * .7, 19, row % 2 ? cyan : pink, side * row * 1.1, (.55 + row * .7) / 2);
      for (let seat = 0; seat < 7; seat++) {
        sphere(stand, .42, [gold, pink, cyan, white][(seat + row) % 4], side * row * 1.1,
          .95 + row * .7, -8 + seat * 2.6);
      }
    }
    box(stand, 10.5, .45, 21, navy, side * 1.5, 6.3);
    for (const z of [-9, 9]) box(stand, .32, 6.2, .32, white, side * 5, 3.1, z);
  }
  for (let i = 0; i < 12; i++) {
    const board = roadside(length * (i + .055) / 12, i % 2 ? -1 : 1, roadHalf + 6, 4);
    if (!board) continue;
    box(board, 8, 2.5, .5, i % 2 ? pink : cyan, 0, 1.8);
    add(board, new THREE.PlaneGeometry(7.7, 2.1), label(i % 2 ? 'LET’S RACE!' : 'TURBO TRAIL'), 0, 1.8, -.27).rotation.y = Math.PI;
  }
  if (track.id === 'meadow') {
    for (const fraction of [.022, .105, .37, .77]) {
      const arch = groupAt(length * fraction);
      for (let i = 0; i < 5; i++) {
        const rainbow = add(arch, new THREE.TorusGeometry(roadHalf + 6 + i * .82, .43, 8, 40, Math.PI),
          material([0xff668f, 0xffb837, 0xffed66, 0x57e5ce, 0x66baff][i]), 0, 1.3);
        rainbow.scale.y = .65;
      }
      for (const side of [-1, 1]) {
        for (let puff = 0; puff < 3; puff++) sphere(arch, 1.8, white, side * (roadHalf + 7) + puff * .9, 1.2 + puff * .6);
      }
    }
    for (let i = 0; i < 8; i++) {
      const windmill = roadside(length * (.075 + i * .11), i % 2 ? -1 : 1, roadHalf + 24, 10);
      if (!windmill) continue;
      add(windmill, new THREE.CylinderGeometry(3.0, 4.8, 12, 12), white, 0, 6);
      add(windmill, new THREE.ConeGeometry(4.8, 4.5, 12), pink, 0, 14);
      const blades = new THREE.Group(); blades.position.set(0, 10, -3.7); windmill.add(blades);
      for (let blade = 0; blade < 4; blade++) {
        const wing = new THREE.Group(); wing.rotation.z = blade * Math.PI / 2;
        box(wing, 1.5, 7, .32, blade % 2 ? gold : cyan, 0, 4.2); blades.add(wing);
      }
      sphere(blades, .8, navy); animated.push({ kind: 'windmill', blades });
    }
    for (let i = 0; i < 4; i++) {
      const balloon = roadside(length * (.055 + i * .22), i % 2 ? -1 : 1, roadHalf + 52, 15);
      if (!balloon) continue;
      sphere(balloon, 7, [pink, cyan, gold, material(0x9c7aef)][i], 0, 25).scale.y = 1.25;
      for (const angle of [0, Math.PI / 2]) add(balloon, new THREE.TorusGeometry(7.05, .35, 8, 24), white, 0, 25).rotation.y = angle;
      box(balloon, 3.8, 2.3, 3.8, gold, 0, 12);
      for (const x of [-1.6, 1.6]) box(balloon, .13, 5.3, .13, white, x, 15.5);
    }
    for (let i = 0; i < 45; i++) {
      const flowers = roadside(length * ((i * .618) % 1), i % 2 ? -1 : 1, roadHalf + 7, 2);
      if (!flowers) continue;
      box(flowers, .15, 1.5, .15, material(0x32ac71), 0, .75);
      const petalPaint = i % 2 ? pink : gold;
      for (let petal = 0; petal < 5; petal++) sphere(flowers, .44, petalPaint,
        Math.cos(petal * Math.PI * 2 / 5) * .5, 1.6 + Math.sin(petal * Math.PI * 2 / 5) * .5);
      sphere(flowers, .3, white, 0, 1.6, -.32);
    }
  } else if (track.id === 'canyon') {
    for (let i = 0; i < 12; i++) {
      const mesa = roadside(length * (i + .3) / 12, i % 2 ? -1 : 1, roadHalf + 38, 16);
      if (!mesa) continue;
      for (let layer = 0; layer < 3; layer++) add(mesa,
        new THREE.CylinderGeometry(9 - layer * 2, 13 - layer * 2, 8, 7),
        material([0xc57345, 0xe49453, 0xfbb46c][layer]), 0, 4 + layer * 8);
    }
    for (let i = 0; i < 15; i++) {
      const cactus = roadside(length * (i + .1) / 15, i % 2 ? -1 : 1, roadHalf + 8, 3);
      if (!cactus) continue;
      add(cactus, new THREE.CapsuleGeometry(.75, 4.5, 4, 10), material(0x35ab7b), 0, 3);
      for (const side of [-1, 1]) {
        box(cactus, 1.7, .9, .9, material(0x35ab7b), side * 1.2, side < 0 ? 2.8 : 4);
        add(cactus, new THREE.CapsuleGeometry(.46, 1.3, 4, 8), material(0x35ab7b), side * 1.9, side < 0 ? 3.5 : 4.7);
      }
      sphere(cactus, .5, pink, 0, 6.1);
    }
  } else if (track.id === 'snow') {
    const pine = material(0x229b98);
    for (let i = 0; i < 26; i++) {
      const tree = roadside(length * (i + .5) / 26, i % 2 ? -1 : 1, roadHalf + 10, 4);
      if (!tree) continue;
      box(tree, .65, 5, .65, navy, 0, 2.5);
      for (let tier = 0; tier < 3; tier++) {
        add(tree, new THREE.ConeGeometry(3.4 - tier * .7, 4, 10), pine, 0, 3.6 + tier * 2.4);
        add(tree, new THREE.ConeGeometry(2.6 - tier * .6, 2.8, 10), white, 0, 4.35 + tier * 2.4);
      }
    }
    for (let i = 0; i < 10; i++) {
      const snowman = roadside(length * (i + .08) / 10, i % 2 ? -1 : 1, roadHalf + 8, 4);
      if (!snowman) continue;
      sphere(snowman, 2.4, white, 0, 2.3); sphere(snowman, 1.6, white, 0, 5.6);
      box(snowman, 3.4, .7, 3.1, pink, 0, 4.5);
      sphere(snowman, .16, navy, -.5, 5.9, -1.5); sphere(snowman, .16, navy, .5, 5.9, -1.5);
      const nose = add(snowman, new THREE.ConeGeometry(.26, 1.3, 8), gold, 0, 5.6, -1.9); nose.rotation.x = -Math.PI / 2;
      add(snowman, new THREE.CylinderGeometry(1.3, 1.3, 1.6, 12), navy, 0, 7.4);
      add(snowman, new THREE.CylinderGeometry(1.9, 1.9, .25, 12), navy, 0, 6.65);
    }
    for (const fraction of [.025, .19, .48, .84]) {
      const arch = groupAt(length * fraction);
      for (const side of [-1, 1]) {
        box(arch, 4.2, 8.5, 4.2, material(0x86dcf7, .2), side * (roadHalf + 6), 4.25);
        add(arch, new THREE.ConeGeometry(3.5, 6, 6), white, side * (roadHalf + 6), 11);
      }
      box(arch, (roadHalf + 6) * 2 + 4, 2, 3, material(0xa7eeff, .25), 0, 9.3);
      add(arch, new THREE.PlaneGeometry(13, 2.6), label('FROST PEAK'), 0, 9.4, -1.55).rotation.y = Math.PI;
    }
  } else if (track.id === 'harbor') {
    for (let i = 0; i < 9; i++) {
      const stack = roadside(length * (i + .02) / 9, i % 2 ? -1 : 1, roadHalf + 11, 10);
      if (!stack) continue;
      for (let row = 0; row < 3; row++) {
        const paint = [cyan, pink, gold][(i + row) % 3];
        box(stack, 7.5, 3.5, 12, paint, row === 2 ? 1.2 : 0, 1.75 + row * 3.5);
        for (let rib = 0; rib < 8; rib++) box(stack, .16, 3.2, 12.12, white, -3.25 + rib * .92, 1.75 + row * 3.5);
      }
    }
    for (const fraction of [.025, .39, .76]) {
      const lighthouse = roadside(length * fraction, 1, roadHalf + 35, 9);
      if (!lighthouse) continue;
      for (let tier = 0; tier < 5; tier++) add(lighthouse,
        new THREE.CylinderGeometry(3.3 - tier * .2, 3.5 - tier * .2, 3, 14), tier % 2 ? pink : white, 0, 1.5 + tier * 3);
      add(lighthouse, new THREE.CylinderGeometry(3.6, 3.6, 3, 14), cyan, 0, 16.5);
      add(lighthouse, new THREE.ConeGeometry(4.5, 3, 14), navy, 0, 19.5);
    }
  }
  return {
    features,
    animate(time) {
      for (const entry of animated) {
        if (entry.kind === 'windmill') entry.blades.rotation.z = time * .65;
        else if (entry.kind === 'pad') {
          entry.paint.emissiveIntensity = .28 + Math.sin(time * 5) * .15;
          entry.trim.opacity = .62 + Math.sin(time * 5) * .20;
        } else {
          const at = pose(entry.feature.distance), lateral = featureLateral(entry.feature, time);
          entry.mover.position.copy(at.point).addScaledVector(at.right, lateral);
          if (entry.mover.userData.ball && entry.feature.kind !== 'bumper')
            entry.mover.userData.ball.rotation.z = -lateral / 3;
        }
      }
    },
  };
}
