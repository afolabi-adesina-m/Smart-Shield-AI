/** Typing stays available for walking, cycling, a stopped car, and a passenger. */

export const TYPING_LOCK_KMH = 10;

export function typingLocked(
  speedKmh: number | null,
  mode: string,
  navigating: boolean,
  passenger: boolean,
): boolean {
  if (passenger || !navigating) return false;
  if (mode !== "drive" && mode !== "motorcycle") return false;
  if (speedKmh == null || !Number.isFinite(speedKmh)) return false;
  return speedKmh > TYPING_LOCK_KMH;
}
