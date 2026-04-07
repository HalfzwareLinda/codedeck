/** Wrap-around index navigation for cycling through lists. */
export const cycleIndex = (current: number, length: number, dir: 1 | -1): number =>
  (current + dir + length) % length;
