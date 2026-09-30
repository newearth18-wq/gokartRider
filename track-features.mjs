const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const LAYOUTS = {
  meadow: [
    ['boost', .032, -6, 11, 15], ['ramp', .065, -6, 11, 18],
    ['bumper', .15, 0, 6, 6], ['boost', .30, 7, 10, 15],
    ['ramp', .43, 6, 10, 18], ['bumper', .61, 0, 6, 6], ['boost', .79, -7, 10, 15],
  ],
  canyon: [
    ['boost', .032, -6, 11, 15], ['ramp', .065, -6, 11, 18],
    ['boulder', .16, 0, 6, 6], ['sand', .24, -7, 13, 64],
    ['boost', .40, 7, 10, 15], ['ramp', .55, 6, 10, 18], ['boulder', .70, 0, 6, 6],
  ],
  snow: [
    ['boost', .032, -6, 11, 15], ['ramp', .065, -6, 11, 18],
    ['ice', .16, 0, 27, 82], ['snowball', .32, 0, 6, 6],
    ['boost', .46, 7, 10, 15], ['ramp', .59, 6, 10, 18], ['ice', .73, -7, 13, 70],
  ],
  harbor: [
    ['boost', .032, -6, 11, 15], ['ramp', .065, -6, 11, 18],
    ['cargo', .16, 0, 6, 6], ['boost', .34, 7, 10, 15],
    ['ramp', .49, 6, 10, 18], ['cargo', .63, 0, 6, 6], ['boost', .81, -7, 10, 15],
  ],
};
export const FEATURE_INFO = {
  boost: { label: 'แผ่นเร่งความเร็ว', hint: 'ขับทับลูกศรเพื่อรับบูสต์', color: 0x27ddf5, icon: '»' },
  ramp: { label: 'ทางกระโดด', hint: 'ขึ้นทางลาดแล้วลอยข้ามพื้น', color: 0xffbe31, icon: '↗' },
  bumper: { label: 'ลูกตุ้มสายรุ้ง', hint: 'สังเกตจังหวะและเลี้ยวหลบ', color: 0xff699a, icon: '!' },
  boulder: { label: 'หินกลิ้ง', hint: 'หลบหินที่กลิ้งข้ามถนน', color: 0xff9045, icon: '!' },
  snowball: { label: 'บอลหิมะ', hint: 'เลือกช่องว่างแล้วเลี้ยวผ่าน', color: 0xa8e8ff, icon: '!' },
  cargo: { label: 'กล่องสินค้าเคลื่อนที่', hint: 'หลบสินค้าบนรางเครน', color: 0xff925a, icon: '!' },
  ice: { label: 'ลานน้ำแข็ง', hint: 'ลดความเร็วและเลี้ยวล่วงหน้า', color: 0x96edff, icon: '❄' },
  sand: { label: 'พื้นทราย', hint: 'เลือกเลนยางมะตอยเพื่อรักษาความเร็ว', color: 0xffd168, icon: '≈' },
};
export const isMovingObstacle = feature => ['bumper', 'boulder', 'snowball', 'cargo'].includes(feature.kind);

export function createTrackFeatures(trackId, length) {
  return (LAYOUTS[trackId] || LAYOUTS.meadow).map(([kind, at, lateral, width, size], index) => ({
    id: `${trackId}-${index}`, kind, distance: at * length, lateral, width, length: size,
    period: 7 + index % 3, phase: index * 1.37, amplitude: 9,
  }));
}

export function featureLateral(feature, time) {
  return feature.lateral + (isMovingObstacle(feature) ?
    Math.sin(time * Math.PI * 2 / feature.period + feature.phase) * feature.amplitude : 0);
}

// Relative distance to the nearest instance of a feature on this closed track.
export function featureGap(distance, feature, length) {
  return ((distance - feature.distance + length / 2) % length + length) % length - length / 2;
}

export function rampHeight(state, features, length) {
  if ((state.airHeight || 0) > 0) return 0;
  for (const feature of features) {
    if (feature.kind !== 'ramp' || Math.abs(state.lateral - feature.lateral) > feature.width / 2) continue;
    const gap = featureGap(state.distance, feature, length);
    if (gap >= -feature.length / 2 && gap <= feature.length / 2) {
      return (gap / feature.length + .5) * 1.8;
    }
  }
  return 0;
}

export function surfaceAt(state, features, length) {
  if ((state.airHeight || 0) > .5) return null;
  return features.find(feature => ['ice', 'sand'].includes(feature.kind) &&
    Math.abs(featureGap(state.distance, feature, length)) <= feature.length / 2 &&
    Math.abs(state.lateral - feature.lateral) <= feature.width / 2)?.kind || null;
}

export function advanceJump(state, dt) {
  if (!(state.airHeight > 0 || state.airVelocity > 0)) return false;
  state.airVelocity -= 22 * dt;
  state.airHeight = Math.max(0, state.airHeight + state.airVelocity * dt);
  if (state.airHeight === 0) { state.airVelocity = 0; return true; }
  return false;
}

// Sweep a segment against the obstacle's expanded box, including its sideways motion.
function intersects(oldGap, gap, oldSide, side, halfLength, halfWidth) {
  let enter = 0, leave = 1;
  for (const [start, end, extent] of [[oldGap, gap, halfLength], [oldSide, side, halfWidth]]) {
    const delta = end - start;
    if (Math.abs(delta) < .00001) { if (Math.abs(start) > extent) return false; continue; }
    const a = (-extent - start) / delta, b = (extent - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  return true;
}

export function applyTrackFeatures(state, previous, features, length, time, dt, visits, shield = false) {
  const events = [];
  for (const feature of features) {
    const gap = featureGap(state.distance, feature, length);
    const oldGap = gap - (state.distance - previous.distance);
    const side = state.lateral - featureLateral(feature, time);
    if (isMovingObstacle(feature)) {
      if ((state.airHeight || 0) > 4.8) continue;
      const oldSide = previous.lateral - featureLateral(feature, time - dt);
      const halfLength = feature.length / 2 + 2.6;
      const halfWidth = feature.width / 2 + 1.8;
      if (!intersects(oldGap, gap, oldSide, side, halfLength, halfWidth)) continue;
      const direction = Math.sign(side) || Math.sign(oldSide) || 1;
      const target = featureLateral(feature, time) + direction * (halfWidth + .05);
      if (Math.abs(target) <= 15.15) {
        state.lateral = target;
        state.lateralVelocity = direction * 5;
      } else {
        state.distance -= gap + halfLength + .05;
        state.lateralVelocity = -direction * 5;
      }
      // Keep a rolling kart recoverable; no obstacle spans the whole road.
      if (time - (visits.get(feature.id) ?? -10) > .85) {
        state.speed *= shield ? .85 : .55;
        state.heading = clamp((state.heading || 0) + direction * .16, -.75, .75);
        visits.set(feature.id, time);
        events.push({ kind: 'obstacle', feature });
      }
      continue;
    }
    if (Math.abs(side) > feature.width / 2 || (state.airHeight || 0) > .5) continue;
    const lap = Math.floor((state.distance - feature.distance) / length + .5);
    const key = `${feature.id}:${lap}`;
    if (visits.has(key)) continue;
    if (feature.kind === 'boost' && oldGap <= feature.length / 2 && gap >= -feature.length / 2 && state.speed > 5) {
      state.boostTime = Math.max(state.boostTime || 0, 1.4);
      state.speed = Math.min(92, state.speed + 9);
      visits.set(key, true);
      events.push({ kind: 'boost', feature });
    } else if (feature.kind === 'ramp' && oldGap < feature.length / 2 && gap >= feature.length / 2 && state.speed > 12) {
      state.airHeight = 1.8;
      state.airVelocity = 7.2 + state.speed * .035;
      visits.set(key, true);
      events.push({ kind: 'jump', feature });
    }
  }
  return events;
}
