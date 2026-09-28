export const KART_LENGTH_GAP = 5.4;
export const KART_SIDE_GAP = 3.7;

// Resolve in track coordinates so the same bumper rules work on every bend.
// Checking the path from previous to proposed position also stops fast karts
// from stepping completely through another kart in one frame.
export function resolveKartCollision(previous, proposed, rival, roadHalf = 17.5) {
  const oldGap = rival.distance - previous.distance;
  const newGap = rival.distance - proposed.distance;
  const oldSide = rival.lateral - previous.lateral;
  const newSide = rival.lateral - proposed.lateral;
  const sideNear = Math.min(Math.abs(oldSide), Math.abs(newSide)) < KART_SIDE_GAP ||
    oldSide * newSide < 0;
  const crossedFromBehind = oldGap >= KART_LENGTH_GAP && newGap < KART_LENGTH_GAP && sideNear;
  const crossedFromFront = oldGap <= -KART_LENGTH_GAP && newGap > -KART_LENGTH_GAP && sideNear;
  const overlapping = Math.abs(newGap) < KART_LENGTH_GAP && Math.abs(newSide) < KART_SIDE_GAP;
  if (!crossedFromBehind && !crossedFromFront && !overlapping) return null;

  const result = { ...proposed };
  const longitudinal = crossedFromBehind || crossedFromFront ||
    (KART_LENGTH_GAP - Math.abs(newGap)) / KART_LENGTH_GAP <=
      (KART_SIDE_GAP - Math.abs(newSide)) / KART_SIDE_GAP;
  if (longitudinal) {
    const behind = crossedFromBehind || !crossedFromFront &&
      (oldGap > 0 || oldGap === 0 && newGap >= 0);
    result.distance = rival.distance + (behind ? -KART_LENGTH_GAP : KART_LENGTH_GAP);
    result.speed = behind ? Math.min(proposed.speed, Math.max(0, rival.speed * .6)) :
      Math.min(proposed.speed, Math.max(8, rival.speed * .85));
    result.lateralVelocity = (proposed.lateralVelocity || 0) * .45;
    result.axis = 'front';
  } else {
    const side = Math.sign(proposed.lateral - rival.lateral) ||
      Math.sign(previous.lateral - rival.lateral) || 1;
    const target = rival.lateral + side * KART_SIDE_GAP;
    // At a rail the bumper must still separate the karts longitudinally.
    if (Math.abs(target) > roadHalf - 2.35) {
      const behind = oldGap >= 0;
      result.distance = rival.distance + (behind ? -KART_LENGTH_GAP : KART_LENGTH_GAP);
      result.speed = Math.min(proposed.speed, Math.max(0, rival.speed * .65));
      result.axis = 'front';
    } else {
      result.lateral = target;
      result.lateralVelocity = side * Math.max(3, Math.abs(proposed.lateralVelocity || 0) * .35);
      result.speed = Math.max(0, proposed.speed * .78);
      result.axis = 'side';
    }
  }
  result.impact = Math.max(Math.abs(proposed.speed - rival.speed), proposed.speed * .45);
  return result;
}
