export function settleRoadEdge(lateral, lateralVelocity, speed, steer, dt, roadHalf) {
  // Keep the full kart inside the painted road, with room to steer away from the rail.
  const safeHalf = roadHalf - 2.35;
  const shoulder = safeHalf - 1.8;
  const side = Math.sign(lateral);
  if (Math.abs(lateral) > shoulder && side !== 0) {
    const pressure = Math.min(1, (Math.abs(lateral) - shoulder) / 1.8);
    // A soft spring returns a stopped kart as well as one that is moving.
    lateralVelocity -= side * (10 + 14 * pressure) * dt;
    if (side * steer > 0) lateralVelocity -= side * 8 * pressure * dt;
    // Shoulder drag only applies at speed; it must never overpower the gas at a standstill.
    if (speed > 22) speed = Math.max(22, speed - 9 * pressure * dt);
  }
  if (Math.abs(lateral) > safeHalf) {
    lateral = side * safeHalf;
    lateralVelocity = Math.min(0, lateralVelocity * side) * side;
  }
  return { lateral, lateralVelocity, speed };
}
