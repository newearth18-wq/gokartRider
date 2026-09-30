import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackFeatures, applyTrackFeatures, advanceJump, surfaceAt, rampHeight,
  featureLateral } from '../track-features.mjs';
import { resolveKartCollision } from '../collision.mjs';

const length = 3000;
const features = createTrackFeatures('meadow', length);
const makeRacer = (distance, lateral) => ({ distance, lateral, speed: 60, heading: 0,
  lateralVelocity: 0, boostTime: 0, airHeight: 0, airVelocity: 0 });

test('pads require the correct lane, trigger once per lap and work after the start grid', () => {
  const pad = features[0], visits = new Map();
  const racer = makeRacer(pad.distance, 8);
  const contact = () => applyTrackFeatures(racer, { distance: racer.distance - 4, lateral: racer.lateral },
    features, length, 4, .05, visits);
  assert.equal(contact().length, 0, 'missing the pad gives no boost');
  racer.lateral = pad.lateral;
  assert.equal(contact()[0].kind, 'boost');
  assert.ok(racer.boostTime > 1 && racer.speed > 60);
  assert.equal(contact().length, 0, 'staying on the pad cannot retrigger');
  racer.distance += length;
  assert.equal(contact()[0].kind, 'boost', 'pad is reusable next lap');
  racer.distance = -20; visits.clear();
  assert.equal(contact().length, 0, 'grid before the start never triggers a pad');
});

test('ramp rises to its lip then launches and lands without getting stuck', () => {
  const ramp = features[1], visits = new Map();
  const racer = makeRacer(ramp.distance, ramp.lateral);
  assert.equal(rampHeight(racer, features, length), .9);
  racer.distance = ramp.distance + ramp.length / 2 + 1;
  const events = applyTrackFeatures(racer, { distance: racer.distance - 5, lateral: racer.lateral },
    features, length, 8, .05, visits);
  assert.equal(events[0].kind, 'jump');
  let maximum = racer.airHeight, landed = false;
  for (let i = 0; i < 120; i++) {
    landed ||= advanceJump(racer, 1 / 60);
    maximum = Math.max(maximum, racer.airHeight);
  }
  assert.ok(maximum > 3 && maximum < 6);
  assert.equal(landed, true); assert.equal(racer.airHeight, 0); assert.equal(racer.airVelocity, 0);
});

test('fast crossing and sideways obstacle motion cause solid contact with an escape lane', () => {
  for (const track of ['meadow', 'canyon', 'snow', 'harbor']) {
    const list = createTrackFeatures(track, length);
    const obstacle = list.find(f => ['bumper', 'boulder', 'snowball', 'cargo'].includes(f.kind));
    const lateral = featureLateral(obstacle, 3);
    const racer = makeRacer(obstacle.distance + 9, lateral);
    const events = applyTrackFeatures(racer, { distance: obstacle.distance - 9, lateral },
      list, length, 3, .05, new Map());
    assert.equal(events[0].kind, 'obstacle', track);
    assert.ok(Math.abs(racer.lateral) <= 15.15);
    const sideGap = Math.abs(racer.lateral - lateral), gap = Math.abs(racer.distance - obstacle.distance);
    assert.ok(sideGap > 4.8 || gap > 5.6, `${track}: no overlap`);
    assert.ok(racer.speed > 0 && racer.speed < 60, 'can drive away after impact');
    const flying = makeRacer(obstacle.distance, lateral); flying.airHeight = 5;
    assert.equal(applyTrackFeatures(flying, flying, list, length, 3, .05, new Map()).length, 0);
  }
  const obstacle = features[2];
  const racer = makeRacer(obstacle.distance, -4.6);
  // At the sinusoid's zero crossing the obstacle sweeps toward the stationary kart.
  const time = (Math.PI - obstacle.phase) * obstacle.period / (2 * Math.PI);
  assert.equal(applyTrackFeatures(racer, racer, [obstacle], length, time, .25, new Map()).length, 1);
});

test('ice and sand only affect their marked lane and do not affect airborne karts', () => {
  for (const [track, kind] of [['snow', 'ice'], ['canyon', 'sand']]) {
    const list = createTrackFeatures(track, length), patch = list.find(f => f.kind === kind);
    const racer = makeRacer(patch.distance, patch.lateral);
    assert.equal(surfaceAt(racer, list, length), kind);
    racer.lateral = patch.lateral + patch.width / 2 + 1;
    assert.equal(surfaceAt(racer, list, length), null);
    racer.lateral = patch.lateral; racer.airHeight = 3;
    assert.equal(surfaceAt(racer, list, length), null);
  }
  assert.equal(resolveKartCollision({ distance: 0, lateral: 0 },
    { distance: 10, lateral: 0, speed: 60, airHeight: 4 },
    { distance: 10, lateral: 0, speed: 40, airHeight: 0 }), null);
});
