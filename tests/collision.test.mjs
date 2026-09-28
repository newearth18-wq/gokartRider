import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKartCollision, KART_LENGTH_GAP, KART_SIDE_GAP } from '../collision.mjs';

test('rear bumper stops a faster kart, including a single-frame pass-through', () => {
  const rival = { distance: 20, lateral: 0, speed: 0 };
  const hit = resolveKartCollision(
    { distance: 10, lateral: 0 },
    { distance: 27, lateral: 0, speed: 65, lateralVelocity: 0 }, rival);
  assert.equal(hit.distance, 20 - KART_LENGTH_GAP);
  assert.equal(hit.speed, 0);
  assert.equal(hit.axis, 'front');
});

test('overtaking in another lane remains possible', () => {
  const rival = { distance: 20, lateral: 0, speed: 0 };
  assert.equal(resolveKartCollision(
    { distance: 10, lateral: 5 },
    { distance: 27, lateral: 5, speed: 65 }, rival), null);
});

test('side contact separates cars without leaving the road', () => {
  const hit = resolveKartCollision(
    { distance: 20, lateral: 4 },
    { distance: 21, lateral: 2, speed: 32, lateralVelocity: -8 },
    { distance: 20, lateral: 0, speed: 26 });
  assert.equal(hit.axis, 'side');
  assert.equal(hit.lateral, KART_SIDE_GAP);
  assert.ok(hit.lateralVelocity > 0);
  const rail = resolveKartCollision(
    { distance: 20, lateral: 15 },
    { distance: 21, lateral: 14.5, speed: 32 },
    { distance: 20, lateral: 12, speed: 26 });
  assert.equal(rail.axis, 'front');
  assert.ok(Math.abs(rail.lateral) <= 17.5);
});

test('stationary front car is separated when rear car catches up', () => {
  const hit = resolveKartCollision(
    { distance: 20, lateral: 0 },
    { distance: 20, lateral: 0, speed: 0 },
    { distance: 17, lateral: 0, speed: 30 });
  assert.equal(hit.distance, 17 + KART_LENGTH_GAP);
});
