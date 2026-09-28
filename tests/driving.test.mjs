import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleRoadEdge } from '../driving.mjs';

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
