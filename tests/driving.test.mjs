import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { TRACKS } from '../config.js';
import { settleRoadEdge, steerThroughCurve } from '../driving.mjs';

test('stopped kart at either edge can accelerate and returns toward the road', () => {
  for (const side of [-1, 1]) {
    let lateral = side * 18.25;
    let lateralVelocity = 0;
    let speed = 0;
    for (let frame = 0; frame < 180; frame++) {
      speed += (27 - speed * .08) / 60;
      lateralVelocity *= .94;
      lateral += lateralVelocity / 60;
      ({ lateral, lateralVelocity, speed } = settleRoadEdge(
        lateral, lateralVelocity, speed, -side, 1 / 60, 17.5));
    }
    assert.ok(speed > 30, `kart on side ${side} accelerates`);
    assert.ok(Math.abs(lateral) < 13, `kart on side ${side} returns to the road`);
  }
});

test('holding gas without steering scrapes bends and loses ground', () => {
  for (const track of TRACKS) {
    const curve = new THREE.CatmullRomCurve3(track.points.map(([x, y, z]) =>
      new THREE.Vector3(x * 2.5, y * 1.25, z * 2.5)), true, 'catmullrom', .5);
    curve.arcLengthDivisions = 1600;
    const length = curve.getLength();
    const tangent = distance => curve.getTangentAt(((distance % length) + length) % length / length).normalize();
    function run(steering) {
      const state = { distance: 0, lateral: 0, speed: 0, heading: 0, lateralVelocity: 0, steerMomentum: 0 };
      let railFrames = 0;
      for (let frame = 0; frame < 60 * 55; frame++) {
        const dt = 1 / 60;
        const steer = steering(state);
        state.speed = Math.min(65, state.speed + (27 - state.speed * .08) * dt);
        const before = tangent(state.distance);
        state.distance += state.speed * Math.cos(state.heading) * dt;
        const after = tangent(state.distance);
        const curveTurn = Math.atan2(before.x * after.z - before.z * after.x,
          before.x * after.x + before.z * after.z);
        Object.assign(state, steerThroughCurve(state, steer, state.speed, 1, curveTurn, dt));
        state.lateral += state.lateralVelocity * dt;
        Object.assign(state, settleRoadEdge(state.lateral, state.lateralVelocity,
          state.speed, steer, dt, 17.5));
        if (Math.abs(state.lateral) > 15) railFrames++;
      }
      return { distance: state.distance, railFrames };
    }
    const gasOnly = run(() => 0);
    const steering = run(state => Math.max(-1, Math.min(1,
      -state.heading * 2.2 - state.lateral * .045)));
    assert.ok(gasOnly.railFrames > 240,
      `${track.id}: gas alone should hit a rail: ${JSON.stringify(gasOnly)}`);
    assert.ok(steering.distance > gasOnly.distance * 1.35,
      `${track.id}: steering should make progress: ${JSON.stringify({ gasOnly, steering })}`);
  }
});
