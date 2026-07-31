/**
 * Mapping from things you can point at on a road to the single number that
 * governs the distribution.
 *
 *   density  k = N / L                    vehicles per km
 *   flow     q = k * v                    vehicles per second past a point
 *   mu       = q * D                      expected secondary brakings per braking
 *
 * mu is the traffic intensity of the bottleneck. Below 1 the cascade dies out;
 * at 1 it terminates but with infinite expected size; above 1 a jam survives
 * forever with probability 1 - q.
 */

import { borelMoments, extinctionProbability } from './borel.js';

export const PARAMS = [
  {
    key: 'carCount',
    label: 'Cars on circuit',
    min: 5,
    max: 240,
    step: 1,
    value: 45,
    format: (v) => String(v),
    note: 'Sets the density, and with speed, the flow past the disturbance.',
  },
  {
    key: 'circuitKm',
    label: 'Circuit length',
    min: 0.5,
    max: 8,
    step: 0.1,
    value: 2.4,
    unit: 'km',
    format: (v) => v.toFixed(1),
    note: 'Same cars on a shorter loop means a denser road.',
  },
  {
    key: 'speedKph',
    label: 'Cruising speed',
    min: 20,
    max: 160,
    step: 1,
    value: 96,
    unit: 'km/h',
    format: (v) => String(v),
    note: 'Faster traffic delivers more cars per second into the disturbance.',
  },
  {
    key: 'clearSec',
    label: 'Clearance time',
    min: 0.4,
    max: 4,
    step: 0.05,
    value: 1.4,
    unit: 's',
    format: (v) => v.toFixed(2),
    note: 'How long one car takes to get through the disturbance. The service time D.',
  },
  {
    key: 'triggerPerMin',
    label: 'Braking events',
    min: 0.5,
    max: 24,
    step: 0.5,
    value: 8,
    unit: '/min',
    format: (v) => v.toFixed(1),
    note: 'How often a cascade is seeded. Changes the pace, not the distribution.',
  },
  {
    key: 'timeScale',
    label: 'Time scale',
    min: 0.25,
    max: 8,
    step: 0.25,
    value: 1,
    unit: '\u00d7',
    format: (v) => v.toFixed(2),
    note: 'Wall-clock speed of the circuit only. The histogram fills independently.',
  },
];

export function defaultParams() {
  return Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));
}

export function deriveMetrics(p) {
  const speedMps = p.speedKph / 3.6;
  const circuitM = p.circuitKm * 1000;
  const densityPerKm = p.carCount / p.circuitKm;
  const flowPerSec = (p.carCount * speedMps) / circuitM;
  const headwaySec = flowPerSec > 0 ? 1 / flowPerSec : Infinity;

  const mu = flowPerSec * p.clearSec;
  const q = extinctionProbability(mu);

  // Conditioned on eventually clearing, a supercritical cascade is Borel with
  // the dual parameter mu*q, which is always < 1. For mu <= 1, q = 1 and this
  // collapses to mu, so one parameter covers both regimes.
  const muEff = mu * q;
  const { mean, variance } = borelMoments(muEff);

  return {
    speedMps,
    circuitM,
    densityPerKm,
    flowPerSec,
    flowPerHour: flowPerSec * 3600,
    headwaySec,
    mu,
    q,
    muEff,
    clearedMean: mean,
    clearedSd: Math.sqrt(variance),
    regime: mu < 1 ? 'subcritical' : mu > 1 ? 'supercritical' : 'critical',
  };
}

/** How far to run the histogram's x-axis: three conditional SDs, clamped. */
export function chartRange(metrics) {
  const { clearedMean, clearedSd } = metrics;
  if (!Number.isFinite(clearedMean) || !Number.isFinite(clearedSd)) return 60;
  return Math.min(60, Math.max(14, Math.ceil(clearedMean + 3 * clearedSd)));
}
