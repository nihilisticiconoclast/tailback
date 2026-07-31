/**
 * The braking cascade as an M/D/1 busy period.
 *
 * One car brakes at the disturbance point and takes D seconds to clear it.
 * Anything arriving during those D seconds has to brake too, and inherits its
 * own D-second window. Because consecutive service windows are disjoint, the
 * arrival counts are i.i.d. Poisson(mu) with mu = lambda*D, and the cars served
 * in a busy period are exactly the nodes of a Galton-Watson tree.
 *
 * Serving in FIFO order means the tree is generated breadth-first, so node
 * index == service order.
 */

import { poissonSample } from './rng.js';

/** Fast path: total progeny only, no allocation. Used to fill the histogram. */
export function sampleBusyPeriod(mu, rand, cap = 200000) {
  let served = 0;
  let inSystem = 1;
  while (inSystem > 0) {
    served += 1;
    inSystem += poissonSample(mu, rand) - 1;
    if (served >= cap) return { size: served, cleared: false };
  }
  return { size: served, cleared: true };
}

/**
 * Slow path: retains parent links so the cascade can be drawn as a tree.
 * Used once per animated jam, not per histogram sample.
 */
export function sampleCascadeTree(mu, rand, cap = 600) {
  const parent = [-1];
  const generation = [0];
  let head = 0;
  let truncated = false;

  while (head < parent.length) {
    const children = poissonSample(mu, rand);
    for (let i = 0; i < children; i += 1) {
      if (parent.length >= cap) {
        truncated = true;
        break;
      }
      parent.push(head);
      generation.push(generation[head] + 1);
    }
    if (truncated) break;
    head += 1;
  }

  let depth = 0;
  for (let i = 0; i < generation.length; i += 1) depth = Math.max(depth, generation[i]);
  return { parent, generation, size: parent.length, depth, truncated };
}

/**
 * Running histogram of cascade sizes. Sizes above BUCKET_MAX are pooled into an
 * overflow count so the tail is never silently dropped.
 */
export class CascadeSampler {
  constructor(bucketMax = 512) {
    this.bucketMax = bucketMax;
    this.counts = new Int32Array(bucketMax + 1);
    this.reset();
  }

  reset() {
    this.counts.fill(0);
    this.overflow = 0;
    this.cleared = 0;
    this.stalled = 0;
    this.sum = 0;
    this.sumSq = 0;
    this.largest = 0;
  }

  record(size, cleared) {
    if (!cleared) {
      this.stalled += 1;
      return;
    }
    this.cleared += 1;
    this.sum += size;
    this.sumSq += size * size;
    if (size > this.largest) this.largest = size;
    if (size <= this.bucketMax) this.counts[size] += 1;
    else this.overflow += 1;
  }

  drawBatch(mu, rand, batch) {
    for (let i = 0; i < batch; i += 1) {
      const { size, cleared } = sampleBusyPeriod(mu, rand);
      this.record(size, cleared);
    }
  }

  get total() {
    return this.cleared + this.stalled;
  }

  get mean() {
    return this.cleared > 0 ? this.sum / this.cleared : NaN;
  }

  get sd() {
    if (this.cleared < 2) return NaN;
    const m = this.mean;
    return Math.sqrt(Math.max(0, this.sumSq / this.cleared - m * m));
  }
}
