/**
 * Borel distribution.
 *
 * If a Galton-Watson process has Poisson(mu) offspring, its total progeny N
 * (root included) satisfies
 *
 *     P(N = n) = exp(-mu*n) * (mu*n)^(n-1) / n!,   n = 1, 2, 3, ...
 *
 * The factor (mu*n)^(n-1) overflows a double by about n = 150, so everything
 * here is computed in log space and exponentiated once at the end.
 */

const LOG_FACTORIAL = [0];

/** log(n!) via cached cumulative sums. Exact recurrence, no Lanczos needed. */
export function logFactorial(n) {
  if (!Number.isInteger(n) || n < 0) return NaN;
  for (let k = LOG_FACTORIAL.length; k <= n; k += 1) {
    LOG_FACTORIAL[k] = LOG_FACTORIAL[k - 1] + Math.log(k);
  }
  return LOG_FACTORIAL[n];
}

export function borelLogPmf(n, mu) {
  if (!Number.isInteger(n) || n < 1) return -Infinity;
  if (mu <= 0) return n === 1 ? 0 : -Infinity;
  return -mu * n + (n - 1) * Math.log(mu * n) - logFactorial(n);
}

export function borelPmf(n, mu) {
  return Math.exp(borelLogPmf(n, mu));
}

export function borelPmfTable(mu, nMax) {
  const table = new Float64Array(nMax + 1);
  for (let n = 1; n <= nMax; n += 1) table[n] = borelPmf(n, mu);
  return table;
}

/**
 * Extinction probability q for Poisson(mu) offspring: the smallest root of
 * q = exp(-mu * (1 - q)). Equal to 1 for mu <= 1.
 *
 * The map is increasing, so iterating up from 0 converges monotonically to the
 * smallest fixed point. Rate of convergence is mu*q < 1.
 */
export function extinctionProbability(mu) {
  if (mu <= 1) return 1;
  let q = 0;
  for (let i = 0; i < 1000; i += 1) {
    const next = Math.exp(-mu * (1 - q));
    if (Math.abs(next - q) < 1e-15) return next;
    q = next;
  }
  return q;
}

/**
 * Moments of a proper Borel(mu), mu < 1. Both diverge at criticality.
 */
export function borelMoments(mu) {
  if (mu >= 1) return { mean: Infinity, variance: Infinity };
  return { mean: 1 / (1 - mu), variance: mu / (1 - mu) ** 3 };
}

/**
 * Borel-Tanner: total progeny when the cascade is seeded by k independent
 * brakers rather than one. Reduces to Borel for k = 1.
 *
 *     P(N = n) = (k/n) * exp(-mu*n) * (mu*n)^(n-k) / (n-k)!,   n >= k
 */
export function borelTannerPmf(n, mu, k) {
  if (!Number.isInteger(n) || n < k) return 0;
  const logP = Math.log(k / n) - mu * n + (n - k) * Math.log(mu * n) - logFactorial(n - k);
  return Math.exp(logP);
}
