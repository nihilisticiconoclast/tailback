/**
 * Seeded pseudo-random numbers, so a given seed reproduces a given run.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Poisson variate. Knuth's product method below mean 30 (expected iterations
 * are mean + 1, so this is cheap in the regime that matters); normal
 * approximation with continuity correction above, where the process is so
 * far supercritical that exactness buys nothing.
 */
export function poissonSample(mean, rand) {
  if (!(mean > 0)) return 0;
  if (mean < 30) {
    const limit = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= rand();
    } while (p > limit);
    return k - 1;
  }
  const u1 = Math.max(rand(), Number.EPSILON);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(mean + Math.sqrt(mean) * z));
}
