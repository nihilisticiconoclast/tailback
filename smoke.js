/**
 * Checks the distribution code against facts it should satisfy.
 * Run with: node test/smoke.mjs
 */

import assert from 'node:assert/strict';
import { borelPmf, borelMoments, extinctionProbability, borelTannerPmf } from '../js/borel.js';
import { sampleBusyPeriod, sampleCascadeTree } from '../js/queue.js';
import { mulberry32 } from '../js/rng.js';
import { deriveMetrics } from '../js/model.js';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const close = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) < tol, `${what}: ${a} vs ${b} (tol ${tol})`);

console.log('borel pmf');

check('n=1,2,3 match hand-enumerated trees', () => {
  const mu = 0.6;
  close(borelPmf(1, mu), Math.exp(-mu), 1e-12, 'P(1)');
  close(borelPmf(2, mu), mu * Math.exp(-2 * mu), 1e-12, 'P(2)');
  close(borelPmf(3, mu), 1.5 * mu ** 2 * Math.exp(-3 * mu), 1e-12, 'P(3)');
});

check('sums to 1 below criticality', () => {
  for (const mu of [0.2, 0.5, 0.7, 0.9]) {
    let total = 0;
    for (let n = 1; n <= 200000; n += 1) total += borelPmf(n, mu);
    close(total, 1, 1e-6, `sum at mu=${mu}`);
  }
});

check('mean matches 1/(1-mu)', () => {
  for (const mu of [0.3, 0.65, 0.85]) {
    let m = 0;
    for (let n = 1; n <= 200000; n += 1) m += n * borelPmf(n, mu);
    close(m, borelMoments(mu).mean, 1e-4, `mean at mu=${mu}`);
  }
});

check('variance matches mu/(1-mu)^3', () => {
  const mu = 0.55;
  let m = 0;
  let m2 = 0;
  for (let n = 1; n <= 200000; n += 1) {
    const p = borelPmf(n, mu);
    m += n * p;
    m2 += n * n * p;
  }
  close(m2 - m * m, borelMoments(mu).variance, 1e-4, 'variance');
});

check('no overflow in the far tail', () => {
  assert.ok(Number.isFinite(borelPmf(5000, 0.9)), 'P(5000) not finite');
  assert.ok(borelPmf(5000, 0.9) > 0, 'P(5000) underflowed to zero');
});

console.log('supercritical regime');

check('extinction probability solves its fixed point', () => {
  for (const mu of [1.2, 1.8, 3]) {
    const q = extinctionProbability(mu);
    close(q, Math.exp(-mu * (1 - q)), 1e-12, `fixed point at mu=${mu}`);
    assert.ok(q < 1, 'q should be below 1 above criticality');
  }
  assert.equal(extinctionProbability(0.8), 1);
  assert.equal(extinctionProbability(1), 1);
});

check('defective mass equals q, and the dual is proper', () => {
  const mu = 1.6;
  const q = extinctionProbability(mu);
  let defective = 0;
  let dual = 0;
  for (let n = 1; n <= 200000; n += 1) {
    defective += borelPmf(n, mu);
    dual += borelPmf(n, mu * q);
  }
  close(defective, q, 1e-8, 'sum of Borel(mu) for mu>1');
  close(dual, 1, 1e-8, 'sum of Borel(mu*q)');
});

console.log('borel-tanner');

check('reduces to borel at k=1', () => {
  for (let n = 1; n <= 12; n += 1) close(borelTannerPmf(n, 0.7, 1), borelPmf(n, 0.7), 1e-12, `n=${n}`);
});

console.log('simulation');

check('busy-period sampler reproduces the mean', () => {
  const mu = 0.7;
  const rand = mulberry32(12345);
  const draws = 300000;
  let total = 0;
  for (let i = 0; i < draws; i += 1) total += sampleBusyPeriod(mu, rand).size;
  close(total / draws, borelMoments(mu).mean, 0.02, 'empirical mean');
});

check('busy-period sampler reproduces P(1) and P(2)', () => {
  const mu = 0.6;
  const rand = mulberry32(777);
  const draws = 300000;
  const hits = [0, 0, 0];
  for (let i = 0; i < draws; i += 1) {
    const { size } = sampleBusyPeriod(mu, rand);
    if (size <= 2) hits[size] += 1;
  }
  close(hits[1] / draws, borelPmf(1, mu), 0.004, 'P(1)');
  close(hits[2] / draws, borelPmf(2, mu), 0.004, 'P(2)');
});

check('tree sampler agrees with the counting sampler', () => {
  const mu = 0.65;
  const a = mulberry32(99);
  const b = mulberry32(99);
  for (let i = 0; i < 500; i += 1) {
    assert.equal(sampleCascadeTree(mu, a, 1e9).size, sampleBusyPeriod(mu, b).size);
  }
});

check('tree parents precede their children', () => {
  const rand = mulberry32(4242);
  for (let i = 0; i < 200; i += 1) {
    const t = sampleCascadeTree(0.85, rand);
    for (let j = 1; j < t.size; j += 1) {
      assert.ok(t.parent[j] < j, 'breadth-first order violated');
      assert.equal(t.generation[j], t.generation[t.parent[j]] + 1);
    }
  }
});

console.log('parameter mapping');

check('mu equals flow times clearance', () => {
  const m = deriveMetrics({
    carCount: 45,
    circuitKm: 2.4,
    speedKph: 96,
    clearSec: 1.4,
    triggerPerMin: 8,
    timeScale: 1,
  });
  close(m.densityPerKm, 18.75, 1e-9, 'density');
  close(m.flowPerSec, 18.75 * (96 / 3.6) / 1000, 1e-9, 'flow');
  close(m.mu, m.flowPerSec * 1.4, 1e-12, 'mu');
  close(m.clearedMean, 1 / (1 - m.mu), 1e-12, 'mean');
  assert.equal(m.regime, 'subcritical');
});

check('supercritical parameters use the dual', () => {
  const m = deriveMetrics({
    carCount: 200,
    circuitKm: 1,
    speedKph: 120,
    clearSec: 2,
    triggerPerMin: 8,
    timeScale: 1,
  });
  assert.ok(m.mu > 1, 'expected supercritical');
  assert.ok(m.muEff < 1, 'dual parameter should be subcritical');
  assert.ok(Number.isFinite(m.clearedMean), 'conditional mean should be finite');
});

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
