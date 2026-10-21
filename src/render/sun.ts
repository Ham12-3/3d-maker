import type { Vec3 } from "@/scene/schema";

const SUNRISE = 5.5;
const SUNSET = 18.5;

/**
 * Sun direction for a time of day (0 to 24). Rises in the east (+x) at 5:30,
 * peaks at 12, sets in the west (-x) at 18:30, below the horizon at night.
 * Tilted towards +z (the default camera side) so the faces we look at are lit
 * and midday shadows aren't straight down.
 */
export function sunDirection(timeOfDay: number): Vec3 {
  const angle = ((timeOfDay - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
  const x = Math.cos(angle);
  const y = Math.sin(angle);
  const z = 0.35;
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/** 0 at night, rising to 1 a little after sunrise. */
export function daylight(timeOfDay: number): number {
  const elevation = sunDirection(timeOfDay)[1];
  return Math.min(1, Math.max(0, (elevation + 0.08) * 3));
}
