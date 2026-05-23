/**
 * Translate a three.js camera position (relative to the bicone at origin) into
 * azimuth (deg around the polar axis), elevation (deg above the equator plane),
 * and the named region of the bicone the camera is currently closest to.
 *
 *   - Light pole   : looking down the axis from above (elevation ≳ 70°)
 *   - Dark pole    : looking up the axis from below   (elevation ≲ -70°)
 *   - Upper tip    : high above the equator           (45 ≤ elevation < 70)
 *   - Lower tip    : well below the equator           (-70 < elevation ≤ -45)
 *   - Equator      : near the equator plane           (|elevation| < 15°)
 *   - Middle interior : elsewhere
 */
export function computeCameraView(position) {
  const x = position?.x ?? 0;
  const y = position?.y ?? 0;
  const z = position?.z ?? 0;
  const horiz = Math.hypot(x, z);
  const elevation = (Math.atan2(y, horiz) * 180) / Math.PI;
  const azimuthRaw = (Math.atan2(z, x) * 180) / Math.PI;
  const azimuth = (azimuthRaw + 360) % 360;
  const region = namedRegion(elevation);
  return { azimuth, elevation, region };
}

export function namedRegion(elevation) {
  if (elevation >= 70) return "Light pole";
  if (elevation <= -70) return "Dark pole";
  if (elevation >= 45) return "Upper tip";
  if (elevation <= -45) return "Lower tip";
  if (Math.abs(elevation) < 15) return "Equator";
  return "Middle interior";
}
