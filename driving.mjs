export function steerThroughCurve(state, steer, speed, steering, curveTurn, dt, drifting = false, grip = 1) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const momentum = state.steerMomentum + (steer - state.steerMomentum) *
    (1 - Math.exp(-dt * (drifting ? 7 : 10)));
  // Keep the kart's world heading when the road bends. The rider must steer into
  // each turn; the road spline only supplies a position, not an invisible pilot.
  const turnRate = momentum * steering * (drifting ? 1.22 : 1.08) *
    (.40 + .60 * Math.min(1, speed / 65));
  const heading = clamp((state.heading - curveTurn + turnRate * dt) *
    Math.exp(-dt * (drifting ? .42 : .70) * grip), -.75, .75);
  const targetSlide = speed * Math.sin(heading) * (drifting ? .72 : .86);
  const lateralVelocity = state.lateralVelocity + (targetSlide - state.lateralVelocity) *
    (1 - Math.exp(-dt * (drifting ? 2.7 : 6) * grip));
  return { steerMomentum: momentum, heading, lateralVelocity };
}

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
    // The shoulder is slow enough that holding gas cannot win the race on a rail.
    if (speed > 18) speed = Math.max(18, speed - 28 * pressure * dt);
  }
  if (Math.abs(lateral) > safeHalf) {
    lateral = side * safeHalf;
    lateralVelocity = Math.min(0, lateralVelocity * side) * side;
    // Steering inward releases the rail immediately so a stopped kart can recover.
    if (side * steer >= 0) speed = Math.min(speed, 14);
  }
  return { lateral, lateralVelocity, speed };
}
